"""Aware UTC time helpers (normalization item 8: every timestamp is timestamptz)."""

from datetime import UTC, date, datetime, timedelta, timezone

from sqlalchemy import Column, MetaData, Table, create_engine, insert, select
from sqlalchemy import Integer

from app.core.time import UTCDateTime, as_utc, utc_now, utc_start_of_day

MINUS_3 = timezone(timedelta(hours=-3))


def test_utc_now_is_aware_utc() -> None:
    now = utc_now()
    assert now.tzinfo is not None
    assert now.utcoffset() == timedelta(0)
    assert abs(datetime.now(UTC) - now) < timedelta(seconds=5)


def test_as_utc_treats_naive_values_as_utc_and_converts_aware_ones() -> None:
    assert as_utc(None) is None
    assert as_utc(datetime(2026, 10, 11, 12, 0)) == datetime(2026, 10, 11, 12, 0, tzinfo=UTC)
    converted = as_utc(datetime(2026, 10, 11, 9, 0, tzinfo=MINUS_3))
    assert converted == datetime(2026, 10, 11, 12, 0, tzinfo=UTC)
    assert converted.utcoffset() == timedelta(0)


def test_utc_start_of_day_is_aware_utc_midnight() -> None:
    expected = datetime(2026, 10, 11, tzinfo=UTC)
    assert utc_start_of_day(date(2026, 10, 11)) == expected
    assert utc_start_of_day(datetime(2026, 10, 11, 18, 30)).utcoffset() == timedelta(0)


def test_utc_datetime_column_returns_the_same_instant_as_aware_utc_on_sqlite() -> None:
    metadata = MetaData()
    table = Table("t", metadata, Column("id", Integer, primary_key=True), Column("at", UTCDateTime()))
    engine = create_engine("sqlite://")
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(insert(table), [
            {"id": 1, "at": datetime(2026, 10, 11, 9, 0, tzinfo=MINUS_3)},
            {"id": 2, "at": datetime(2026, 10, 11, 12, 0)},
        ])
        rows = dict(connection.execute(select(table.c.id, table.c.at)).all())
    assert rows[1] == rows[2] == datetime(2026, 10, 11, 12, 0, tzinfo=UTC)
    assert all(value.utcoffset() == timedelta(0) for value in rows.values())
    assert UTCDateTime().impl.timezone is True
