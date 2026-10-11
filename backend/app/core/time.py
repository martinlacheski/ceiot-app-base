"""Timezone-aware UTC time helpers.

Every persisted timestamp is ``timestamptz`` (migration 0022) and the backend works with
aware UTC ``datetime`` values end to end. A naive value that still reaches these helpers
(a legacy client payload, SQLite in tests) is a UTC wall clock by convention.
"""

from datetime import UTC, date, datetime, time

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


def utc_now() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime | None) -> datetime | None:
    """The same instant as an aware UTC datetime; a naive value is taken as UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def utc_start_of_day(value: date | datetime) -> datetime:
    if isinstance(value, datetime):
        value = value.date()

    return datetime.combine(value, time.min, UTC)


class UTCDateTime(TypeDecorator):
    """``timestamptz`` column that always binds and returns aware UTC datetimes.

    PostgreSQL already returns aware values for ``timestamptz``; the decorator makes the
    contract explicit and keeps SQLite (used by most tests, which has no time zone storage)
    returning aware values too.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return as_utc(value) if isinstance(value, datetime) else value

    def process_result_value(self, value, dialect):
        return as_utc(value) if isinstance(value, datetime) else value
