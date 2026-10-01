"""Bounded execution of validated SQL under the asking user's RLS identity.

Everything happens inside ONE transaction that is always rolled back:

1. ``SET TRANSACTION READ ONLY`` (must be the first statement),
2. ``set_config('app.current_user_id', <identity>, true)`` (same GUC and
   semantics as ``get_authed_session``: ``system_admin`` for administrators,
   the user id otherwise),
3. ``SET LOCAL ROLE ai_readonly`` (drops the login's superuser/BYPASSRLS, so RLS
   applies to the identity above),
4. ``statement_timeout`` / ``lock_timeout`` / ``idle_in_transaction_session_timeout``
   and ``search_path = pg_catalog`` (everything is schema-qualified),
5. the single statement, ``fetchmany(cap + 1)``, byte cap, ROLLBACK.

Failures surface as :class:`QueryFailed` with a short machine code; database
error text is never propagated (it can quote data or schema details).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine

from app.api.assistant.sql_guard import ValidatedSQL, validate_sql

logger = logging.getLogger(__name__)

AI_ROLE = "ai_readonly"
MAX_RESULT_ROWS = 200
MAX_RESULT_BYTES = 64 * 1024
STATEMENT_TIMEOUT_MS = 3_000


@dataclass(frozen=True, slots=True)
class QueryResult:
    columns: tuple[str, ...]
    rows: list[dict[str, Any]]
    truncated: bool
    byte_count: int


class QueryFailed(RuntimeError):
    """The database refused or aborted the query. ``code``: timeout, permission or database."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


def identity_for(user) -> str:
    """The RLS identity the API itself uses for this user (see get_authed_session)."""
    return "system_admin" if user.is_admin else str(user.id)


def _classify(error: DBAPIError) -> str:
    sqlstate = getattr(error.orig, "sqlstate", None) or getattr(error.orig, "pgcode", None)
    if sqlstate in {"57014", "55P03"}:
        return "timeout"
    if sqlstate in {"42501", "25006"}:
        return "permission"
    return "database"


async def run_trusted_query(
    engine: AsyncEngine,
    identity: str,
    sql: str,
    *,
    max_rows: int = MAX_RESULT_ROWS,
    max_bytes: int = MAX_RESULT_BYTES,
    statement_timeout_ms: int = STATEMENT_TIMEOUT_MS,
) -> QueryResult:
    """Run ``sql`` as ``ai_readonly`` inside ``identity``'s RLS scope.

    ``sql`` must come from :func:`execute_validated_sql` or from code-authored
    statements (schema hints); it is never user text.
    """
    if ";" in sql:  # the driver runs stacked statements; never let one through (RESET ROLE)
        raise QueryFailed("rejected")
    timeout = int(statement_timeout_ms)
    async with engine.connect() as connection:
        try:
            await connection.exec_driver_sql("SET TRANSACTION READ ONLY")
            await connection.execute(
                text("SELECT set_config('app.current_user_id', :identity, true)"), {"identity": identity}
            )
            await connection.exec_driver_sql(f"SET LOCAL ROLE {AI_ROLE}")
            await connection.exec_driver_sql(f"SET LOCAL statement_timeout = '{timeout}ms'")
            await connection.exec_driver_sql("SET LOCAL lock_timeout = '250ms'")
            await connection.exec_driver_sql("SET LOCAL idle_in_transaction_session_timeout = '10000ms'")
            await connection.exec_driver_sql("SET LOCAL search_path = pg_catalog")

            # psycopg treats '%' as a placeholder marker whenever the driver is
            # handed a parameter sequence (SQLAlchemy always does), so literal
            # percent signs (LIKE '%x%') are doubled; the colon needs no care
            # because exec_driver_sql bypasses SQLAlchemy's :name binds.
            cursor = await connection.exec_driver_sql(sql.replace("%", "%%"))
            fetched = cursor.fetchmany(max_rows + 1)
            columns = tuple(cursor.keys())
            truncated = len(fetched) > max_rows
            rows: list[dict[str, Any]] = []
            byte_count = 0
            for raw in fetched[:max_rows]:
                row = dict(zip(columns, raw))
                size = len(json.dumps(row, default=str, ensure_ascii=False).encode("utf-8"))
                if byte_count + size > max_bytes:
                    truncated = True
                    break
                byte_count += size
                rows.append(row)
            return QueryResult(columns, rows, truncated, byte_count)
        except DBAPIError as error:
            code = _classify(error)
            logger.warning("Assistant query failed (%s)", code)
            raise QueryFailed(code) from None
        finally:
            await connection.rollback()


async def execute_validated_sql(engine: AsyncEngine, identity: str, validated: ValidatedSQL) -> QueryResult:
    """Execute a :class:`ValidatedSQL`, re-validating it first (policy may have changed)."""
    if not isinstance(validated, ValidatedSQL):
        raise TypeError("execute_validated_sql requires a ValidatedSQL")
    checked = validate_sql(validated.sql)
    return await run_trusted_query(engine, identity, checked.sql)
