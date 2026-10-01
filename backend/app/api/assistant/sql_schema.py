"""Schema prompt for the SQL generator, built per asking user.

Column names and types come from the database catalog (only what ``ai_readonly``
can see, intersected with the in-code catalog); descriptions come from
``catalog.VIEWS``. Distinct-value hints (variables with units, sensor models,
device and environment names) are queried UNDER THE ASKING USER'S IDENTITY, so a
prompt can never mention another tenant's device or environment. Hint strings
are user-authored data: they are sanitized and clipped before they enter a
prompt. Prompts are cached per identity for a short TTL.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.api.assistant.catalog import ALLOWED_COLUMNS, SCHEMA, VIEWS
from app.api.assistant.sql_executor import QueryFailed, run_trusted_query

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 300.0
MAX_CACHED_USERS = 256
MAX_HINT_CHARS = 60

COLUMNS_SQL = (
    "SELECT table_name, column_name, data_type FROM information_schema.columns "
    f"WHERE table_schema = '{SCHEMA}' ORDER BY table_name, ordinal_position"
)
HINT_SQL = {
    "variables": f"SELECT code, name, unit FROM {SCHEMA}.variables ORDER BY code LIMIT 50",
    "sensor_models": f"SELECT DISTINCT sensor_model_code, sensor_model FROM {SCHEMA}.sensors ORDER BY 1 LIMIT 30",
    "devices": f"SELECT serial, name, environment_name FROM {SCHEMA}.devices ORDER BY serial LIMIT 50",
    "environments": f"SELECT name FROM {SCHEMA}.environments ORDER BY name LIMIT 30",
}

RULES = f"""Reglas:
- Un solo SELECT sobre UNA vista {SCHEMA}.<vista>, sin JOIN, CTE, subconsultas ni UNION; la vista telemetry ya trae nombres y unidades.
- Funciones permitidas: AVG, COUNT, MIN, MAX, SUM, ROUND, LOWER, DATE_TRUNC('minute|hour|day|week|month|year', columna).
- Tiempo relativo: solo now() - INTERVAL '<n> hours|days|minutes' (n entero de hasta 3 dígitos); fechas exactas como literal 'YYYY-MM-DDTHH:MM:SSZ'.
- Siempre terminá con LIMIT <n> (1 a 200). Comparaciones de texto sensibles a mayúsculas: usá los valores exactos listados arriba.
- Cada fila de telemetry es UNA medición de UNA variable; para "temperatura" filtrá variable = 'temperature'. Si pedís un promedio, filtrá la variable.
- Si la pregunta no se puede responder con estas vistas, devolvé exactamente NO_ES_POSIBLE."""


@dataclass(frozen=True, slots=True)
class Hints:
    variables: list[tuple[str, str, str]] = field(default_factory=list)  # code, name, unit
    sensor_models: list[tuple[str, str]] = field(default_factory=list)  # code, name
    devices: list[tuple[str, str, str | None]] = field(default_factory=list)  # serial, name, environment
    environments: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class SchemaPrompt:
    text: str
    source: str  # "database" or "static"


_CONTROL = re.compile(r"[\x00-\x1f\x7f`<>|\\]")


def clean_hint(value: Any) -> str | None:
    """Make a stored string safe to quote inside a prompt (data, never instructions)."""
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", _CONTROL.sub(" ", str(value))).strip()
    cleaned = cleaned[:MAX_HINT_CHARS].strip()
    return cleaned or None


def _listing(items: list[str]) -> str:
    return ", ".join(items) if items else "(sin datos)"


def format_schema(columns: list[tuple[str, str, str]], hints: Hints) -> str:
    """Render the prompt text. ``columns`` are (view, column, type) rows from the catalog."""
    found: dict[str, dict[str, str]] = {}
    for view, column, data_type in columns:
        if view in ALLOWED_COLUMNS and column in ALLOWED_COLUMNS[view]:
            found.setdefault(view, {})[column] = data_type
    lines = [f"Vistas disponibles (esquema {SCHEMA}, solo lectura; ya filtradas a los datos que este usuario puede ver):"]
    for view, spec in VIEWS.items():
        described = found.get(view) or {name: kind for name, (kind, _) in spec.items()}
        parts = [f"  {name} {kind} -- {spec[name][1]}" for name, kind in described.items() if name in spec]
        lines.append(f"{SCHEMA}.{view}(\n" + ",\n".join(parts) + "\n)")
    lines.append("Valores exactos presentes (respetá mayúsculas y minúsculas):")
    lines.append("- variable: " + _listing([f"{c} ({n}, unidad {u})" for c, n, u in hints.variables]))
    lines.append("- sensor_model_code: " + _listing([f"{c} ({n})" for c, n in hints.sensor_models]))
    # One field per column, quoted, so the model never merges serial, name and
    # establishment into a single device_name value.
    lines.append(
        "- equipos (usá cada valor en su propia columna): "
        + _listing(
            [
                f"device_serial='{s}', device_name='{n}'" + (f", environment_name='{e}'" if e else "")
                for s, n, e in hints.devices
            ]
        )
    )
    lines.append("- environment_name: " + _listing(hints.environments))
    lines.append(RULES)
    return "\n".join(lines)


Runner = Callable[..., Awaitable[Any]]
_cache: dict[str, tuple[float, SchemaPrompt]] = {}


def clear_cache() -> None:
    _cache.clear()


async def _load(engine, identity: str, runner: Runner) -> SchemaPrompt:
    column_rows = (await runner(engine, identity, COLUMNS_SQL)).rows
    columns = [(r["table_name"], r["column_name"], r["data_type"]) for r in column_rows]
    fetched = {name: (await runner(engine, identity, sql)).rows for name, sql in HINT_SQL.items()}

    def pick(rows, *keys):
        out = []
        for row in rows:
            values = tuple(clean_hint(row[key]) for key in keys)
            if values[0] is not None:
                out.append(values)
        return out

    hints = Hints(
        variables=[(c, n or c, u or "") for c, n, u in pick(fetched["variables"], "code", "name", "unit")],
        sensor_models=[(c, n or c) for c, n in pick(fetched["sensor_models"], "sensor_model_code", "sensor_model")],
        devices=[(s, n or s, e) for s, n, e in pick(fetched["devices"], "serial", "name", "environment_name")],
        environments=[n for (n,) in pick(fetched["environments"], "name")],
    )
    return SchemaPrompt(format_schema(columns, hints), "database")


async def schema_prompt(
    engine,
    identity: str,
    *,
    runner: Runner = run_trusted_query,
    clock: Callable[[], float] = time.monotonic,
    ttl: float = CACHE_TTL_SECONDS,
) -> SchemaPrompt:
    """Prompt for ``identity``, cached for ``ttl`` seconds; static catalog if the DB fails."""
    now = clock()
    cached = _cache.get(identity)
    if cached is not None and cached[0] > now:
        return cached[1]
    try:
        prompt = await _load(engine, identity, runner)
    except QueryFailed:
        return SchemaPrompt(format_schema([], Hints()), "static")
    _cache.pop(identity, None)
    while len(_cache) >= MAX_CACHED_USERS:
        _cache.pop(next(iter(_cache)))
    _cache[identity] = (now + ttl, prompt)
    return prompt
