"""Shared history search, local-time formatting, and deterministic ordering."""

from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import String, cast, or_

from app.core.search import ILIKE_ESCAPE, formatted_datetime, ilike_pattern

SortOrder = Literal["asc", "desc"]
MAX_PAGE_SIZE = 10000


def format_local(value: datetime | None, utc_offset_minutes: int = 0) -> str:
    if value is None:
        return ""
    base = value.astimezone(timezone.utc) if value.tzinfo is not None else value
    return (base + timedelta(minutes=utc_offset_minutes)).strftime("%d/%m/%Y %H:%M")


def formatted_time(column, utc_offset_minutes: int = 0):
    return formatted_datetime(column, utc_offset_minutes, timezone_aware=True)


def text_search(term: str | None, *columns):
    pattern = ilike_pattern(term)
    if pattern is None:
        return None
    return or_(*(cast(column, String).ilike(pattern, escape=ILIKE_ESCAPE) for column in columns))


def ordered(column, sort_order: SortOrder):
    return (column.desc() if sort_order == "desc" else column.asc()).nulls_last()
