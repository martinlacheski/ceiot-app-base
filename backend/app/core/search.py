from typing import Final

from sqlalchemy import String
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.expression import ColumnElement
from sqlalchemy.sql.functions import FunctionElement


ILIKE_ESCAPE: Final = "\\"
MAX_SEARCH_LENGTH: Final = 64


def ilike_pattern(value: str | None) -> str | None:
    """Build a bounded literal substring pattern for SQL ILIKE expressions."""
    cleaned = (value or "").strip()[:MAX_SEARCH_LENGTH]
    if not cleaned:
        return None

    escaped = (
        cleaned.replace(ILIKE_ESCAPE, ILIKE_ESCAPE * 2)
        .replace("%", f"{ILIKE_ESCAPE}%")
        .replace("_", f"{ILIKE_ESCAPE}_")
    )
    return f"%{escaped}%"


class _FormattedSearchValue(FunctionElement):
    """Render dates exactly as the frontend displays them for text search."""

    type = String()
    inherit_cache = False

    def __init__(
        self,
        column: ColumnElement,
        *,
        include_time: bool,
        utc_offset_minutes: int = 0,
        timezone_aware: bool = False,
    ) -> None:
        super().__init__(column)
        self.include_time = include_time
        self.utc_offset_minutes = int(utc_offset_minutes)
        self.timezone_aware = timezone_aware


@compiles(_FormattedSearchValue, "postgresql")
def _compile_formatted_search_value_postgresql(element, compiler, **kwargs):
    column = compiler.process(element.clauses, **kwargs)
    if element.timezone_aware:
        column = f"({column} AT TIME ZONE 'UTC')"
    if element.utc_offset_minutes:
        column = f"({column} + interval '{element.utc_offset_minutes} minutes')"
    template = "DD/MM/YYYY HH24:MI" if element.include_time else "DD/MM/YYYY"
    return f"to_char({column}, '{template}')"


@compiles(_FormattedSearchValue)
def _compile_formatted_search_value_default(element, compiler, **kwargs):
    column = compiler.process(element.clauses, **kwargs)
    template = "%d/%m/%Y %H:%M" if element.include_time else "%d/%m/%Y"
    if element.utc_offset_minutes:
        modifier = f", '{element.utc_offset_minutes:+d} minutes'"
    else:
        modifier = ""
    return f"strftime('{template}', {column}{modifier})"


def formatted_date(column: ColumnElement) -> ColumnElement:
    return _FormattedSearchValue(column, include_time=False)


def formatted_datetime(
    column: ColumnElement,
    utc_offset_minutes: int = 0,
    *,
    timezone_aware: bool = False,
) -> ColumnElement:
    return _FormattedSearchValue(
        column,
        include_time=True,
        utc_offset_minutes=utc_offset_minutes,
        timezone_aware=timezone_aware,
    )
