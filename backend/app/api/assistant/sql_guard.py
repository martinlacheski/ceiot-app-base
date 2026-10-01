"""Strict structural boundary for model-generated SQL (first security layer).

Only one small shape passes: a single SELECT over exactly one ``ai_read`` view,
with an allowlist of nodes, functions and columns, a literal LIMIT and no
comments, CTEs, subqueries, joins or set operations. The caller executes the
SQL *re-rendered from the AST*, never the submitted text. The second layer is
the database itself (``ai_readonly`` role, read-only transaction, RLS identity
of the asking user); neither layer is trusted alone.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Never

from sqlglot import exp, parse
from sqlglot.errors import SqlglotError

from app.api.assistant.catalog import ALLOWED_COLUMNS, SCHEMA

MAX_LIMIT = 200
MAX_SQL_CHARS = 2_000
PUBLIC_MESSAGE = "La consulta generada no está permitida."

ALLOWED_INTERVAL_UNITS = {"HOUR", "HOURS", "DAY", "DAYS", "MINUTE", "MINUTES"}
ALLOWED_TRUNC_UNITS = {"MINUTE", "HOUR", "DAY", "WEEK", "MONTH", "YEAR"}
_INTERVAL_VALUE = re.compile(r"^[0-9]{1,3}$")
_FORBIDDEN_TEXT = re.compile(r"[\x00-\x08\x0b-\x1f\x7f\\]")

AGGREGATES = (exp.Avg, exp.Count, exp.Min, exp.Max, exp.Sum)
SCALAR_FUNCTIONS = (exp.Round, exp.Lower, exp.TimestampTrunc)
ALLOWED_NODES = (
    exp.Select, exp.Alias, exp.Column, exp.Table, exp.Identifier, exp.From, exp.Where,
    exp.Group, exp.Having, exp.Order, exp.Ordered, exp.Limit, exp.Literal, exp.Star,
    exp.Distinct, exp.Paren, exp.And, exp.Or, exp.Not, exp.EQ, exp.NEQ, exp.GT, exp.GTE,
    exp.LT, exp.LTE, exp.In, exp.Between, exp.Is, exp.Null, exp.Boolean, exp.Neg,
    exp.Add, exp.Sub, exp.Mul, exp.Div, exp.Like, exp.ILike, exp.CurrentTimestamp,
    exp.Interval, exp.Var, exp.TableAlias, *AGGREGATES, *SCALAR_FUNCTIONS,
)
ALLOWED_SELECT_ARGS = {"expressions", "from", "where", "group", "having", "order", "limit", "distinct", "kind"}

_ISSUER = object()


class SQLRejected(ValueError):
    """Expected, safe rejection. ``code`` feeds the audit log; ``reason`` is for the repair prompt."""

    public_message = PUBLIC_MESSAGE

    def __init__(self, code: str, reason: str) -> None:
        self.code = code
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True, slots=True)
class ValidatedSQL:
    """SQL that went through :func:`validate_sql`; hand-built instances are refused."""

    sql: str
    view: str
    limit: int
    _issuer: object = field(default=None, repr=False, compare=False)

    def __post_init__(self) -> None:
        if self._issuer is not _ISSUER:
            raise TypeError("ValidatedSQL can only be produced by validate_sql")


def _reject(code: str, reason: str) -> Never:
    raise SQLRejected(code, reason)


def _validate_limit(statement: exp.Select) -> int:
    limit = statement.args.get("limit")
    if not isinstance(limit, exp.Limit):
        _reject("limit", f"se requiere LIMIT literal entre 1 y {MAX_LIMIT}")
    value = limit.expression
    if not isinstance(value, exp.Literal) or value.is_string or not value.is_int:
        _reject("limit", "LIMIT debe ser un entero literal")
    parsed = int(value.this)
    if not 1 <= parsed <= MAX_LIMIT:
        _reject("limit", f"LIMIT debe estar entre 1 y {MAX_LIMIT}")
    return parsed


def _validate_time_forms(statement: exp.Select) -> None:
    """``now()`` and INTERVAL only as ``now() - INTERVAL '<n> hours|days|minutes'``."""
    for node in statement.walk():
        if isinstance(node, exp.CurrentTimestamp):
            parent = node.parent
            bare_comparison = isinstance(parent, (exp.GT, exp.GTE, exp.LT, exp.LTE))
            if not (isinstance(parent, exp.Sub) and parent.this is node) and not bare_comparison:
                _reject("time", "now() solo se permite como now() - INTERVAL '<n> hours|days|minutes'")
        elif isinstance(node, exp.Interval):
            parent = node.parent
            if not (
                isinstance(parent, exp.Sub)
                and parent.expression is node
                and isinstance(parent.this, exp.CurrentTimestamp)
            ):
                _reject("time", "INTERVAL solo se permite restando de now()")
            value = node.this
            if not (isinstance(value, exp.Literal) and value.is_string and _INTERVAL_VALUE.fullmatch(value.this)):
                _reject("time", "el literal de INTERVAL debe ser un entero de hasta 3 dígitos")
            unit = node.args.get("unit")
            if not isinstance(unit, exp.Var) or unit.this.upper() not in ALLOWED_INTERVAL_UNITS:
                _reject("time", "INTERVAL solo admite hours, days o minutes")
        elif isinstance(node, exp.Var):
            parent = node.parent
            in_interval = isinstance(parent, exp.Interval) and parent.args.get("unit") is node
            in_trunc = isinstance(parent, exp.TimestampTrunc) and parent.args.get("unit") is node
            if not (in_interval or in_trunc):
                _reject("construct", "uso de identificador no permitido")


def _validate_functions(statement: exp.Select) -> None:
    for node in statement.walk():
        if isinstance(node, exp.TimestampTrunc):
            unit = node.args.get("unit")
            ok = isinstance(unit, exp.Var) and unit.this.upper() in ALLOWED_TRUNC_UNITS and not node.args.get("zone")
            if not ok:
                _reject("function", "date_trunc solo admite minute, hour, day, week, month o year")
        elif isinstance(node, (exp.Like, exp.ILike)):
            if not isinstance(node.expression, exp.Literal) or not node.expression.is_string:
                _reject("construct", "LIKE solo admite un patrón literal")
        elif isinstance(node, exp.Round):
            decimals = node.args.get("decimals")
            if decimals is not None and not (isinstance(decimals, exp.Literal) and decimals.is_int):
                _reject("function", "ROUND solo admite decimales literales")
        elif isinstance(node, exp.Literal) and node.is_string and _FORBIDDEN_TEXT.search(node.this):
            _reject("literal", "literal de texto no permitido")


def validate_sql(sql: str) -> ValidatedSQL:
    """Accept only a direct, bounded SELECT over one ``ai_read`` view (see module docstring)."""
    if not isinstance(sql, str) or not sql.strip():
        _reject("empty", "la consulta está vacía")
    if len(sql) > MAX_SQL_CHARS:
        _reject("size", f"la consulta supera {MAX_SQL_CHARS} caracteres")
    if "--" in sql or "/*" in sql or "*/" in sql:
        _reject("comment", "no se permiten comentarios")
    if _FORBIDDEN_TEXT.search(sql):
        _reject("literal", "la consulta contiene caracteres no permitidos")
    # One trailing semicolon is the usual way a model ends a statement; any other
    # semicolon (stacked statements, or inside a literal) is refused outright because
    # the driver would run stacked statements and RESET ROLE would drop the sandbox.
    sql = sql.strip()
    if sql.endswith(";"):
        sql = sql[:-1].rstrip()
    if ";" in sql:
        _reject("statement", "se permite exactamente una sentencia SELECT sin punto y coma intermedio")

    try:
        statements = parse(sql, read="postgres")
    except SqlglotError as error:
        _reject("syntax", f"SQL PostgreSQL inválido ({str(error).splitlines()[0][:120]})")

    if len(statements) != 1 or not isinstance(statements[0], exp.Select):
        _reject("statement", "se permite exactamente una sentencia SELECT")
    statement = statements[0]

    if statement.args.get("with") is not None:
        _reject("cte", "no se permiten CTE")
    if sum(1 for _ in statement.find_all(exp.Select)) != 1 or any(
        True for _ in statement.find_all(exp.Subquery)
    ):
        _reject("subquery", "no se permiten subconsultas")

    unexpected = {name for name, value in statement.args.items() if value and name not in ALLOWED_SELECT_ARGS}
    if unexpected:
        _reject("construct", f"la forma de SELECT no está permitida ({', '.join(sorted(unexpected))})")

    tables = list(statement.find_all(exp.Table))
    if len(tables) != 1:
        _reject("view", "se requiere exactamente una vista directa")
    table = tables[0]
    extra_table_args = {k for k, v in table.args.items() if v and k not in {"this", "db", "alias"}}
    if extra_table_args or not isinstance(table.this, exp.Identifier):
        _reject("construct", "la forma de la relación no está permitida")
    if table.catalog or table.db != SCHEMA or table.name not in ALLOWED_COLUMNS:
        _reject("view", f"solo se permiten las vistas {SCHEMA}.<vista> publicadas")
    alias = table.args.get("alias")
    if alias is not None and alias.args.get("columns"):
        _reject("construct", "no se permiten listas de columnas en alias")

    for node in statement.walk():
        if not isinstance(node, ALLOWED_NODES):
            _reject("construct", f"la construcción {type(node).__name__} no está permitida")

    _validate_functions(statement)
    _validate_time_forms(statement)

    view = table.name
    relation_names = {view}
    if table.alias:
        relation_names.add(table.alias)
    output_aliases = {a.alias for a in statement.find_all(exp.Alias) if a.alias}
    for column in statement.find_all(exp.Column):
        if len(column.parts) > 2 and not (len(column.parts) == 2):
            _reject("relation", "las columnas no pueden usar esquema")
        if column.table and column.table not in relation_names:
            _reject("relation", "la columna usa una relación no permitida")
        if column.table and table.alias and column.table == view:
            _reject("relation", "la columna usa una relación no permitida")
        if column.name not in ALLOWED_COLUMNS[view] | output_aliases:
            _reject("column", f"la columna {column.name!r} no está expuesta en {view}")

    limit = _validate_limit(statement)
    return ValidatedSQL(sql=statement.sql(dialect="postgres"), view=view, limit=limit, _issuer=_ISSUER)
