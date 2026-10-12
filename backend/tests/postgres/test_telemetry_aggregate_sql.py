"""Telemetry aggregation by time bucket in SQL: avg/min/max/count, local-midnight origin, access, RLS."""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.sensor_catalog.telemetry import aggregate_telemetry
from telemetry_rollup import refresh_hourly
from test_device_history_environment_snapshot import history_rows

pytestmark = pytest.mark.asyncio

START = datetime(2026, 3, 1, tzinfo=timezone.utc)
END = datetime(2026, 3, 5, tzinfo=timezone.utc)
HOUR = 3600
DAY = 24 * HOUR

ROWS = [
    ("2026-03-02T23:10:00Z", '{"dht22":{"temperature":20.0,"relative_humidity":50},"bmp280":{"pressure":1000}}'),
    ("2026-03-02T23:50:00Z", '{"dht22":{"temperature":30.0,"relative_humidity":70}}'),
    ("2026-03-03T00:30:00Z", '{"dht22":{"temperature":10.0}}'),
    # 03:30Z is 00:30 local (UTC-3) on 03-03: the next local day.
    ("2026-03-03T03:30:00Z", '{"dht22":{"temperature":40.0},"bmp280":{"pressure":1010}}'),
    ("2026-03-03T03:40:00Z", '{"dht22":{"temperature":"bad"},"weird":5}'),
]


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def _seed(admin, device_id, serial):
    ids = []
    async with admin.begin() as connection:
        for when, values in ROWS:
            row_id = uuid.uuid4()
            ids.append(row_id)
            await connection.execute(text('INSERT INTO telemetry (time, id, device_id, device_serial, "values") '
                'VALUES (CAST(:time AS timestamptz), :id, :device, :serial, CAST(:values AS jsonb))'),
                {"time": when, "id": row_id, "device": device_id, "serial": serial, "values": values})
    return ids


async def _identity(session, user_id):
    await session.execute(text("SELECT set_config('app.current_user_id', :id, true)"), {"id": str(user_id)})


async def test_hourly_buckets_stats_and_local_midnight_days(postgres_rls_config, rls_engine_factory, history_rows):
    admin = create_async_engine(postgres_rls_config.admin_url)
    ids = await _seed(admin, history_rows.device_id, history_rows.device_serial)
    # Hour-or-larger buckets read the hourly rollup: materialize the seeded (past) window.
    await refresh_hourly(postgres_rls_config.admin_url, START, END)
    try:
        role = rls_engine_factory()
        async with AsyncSession(role) as session:
            await _identity(session, history_rows.old_owner_id)
            hourly = await aggregate_telemetry(session, history_rows.device_id, START, END, HOUR)
            assert [item["time"] for item in hourly] == [
                _utc("2026-03-02T23:00:00Z"), _utc("2026-03-03T00:00:00Z"), _utc("2026-03-03T03:00:00Z")]
            assert all(item["time"].utcoffset().total_seconds() == 0 for item in hourly)
            first, second, third = hourly
            assert first["values"] == {
                "dht22": {"temperature": {"avg": 25.0, "min": 20.0, "max": 30.0, "count": 2},
                          "relative_humidity": {"avg": 60.0, "min": 50.0, "max": 70.0, "count": 2}},
                "bmp280": {"pressure": {"avg": 1000.0, "min": 1000.0, "max": 1000.0, "count": 1}}}
            assert second["values"] == {"dht22": {"temperature": {"avg": 10.0, "min": 10.0, "max": 10.0, "count": 1}}}
            # Non-numeric and non-object values are ignored, never fail the query.
            assert third["values"] == {
                "dht22": {"temperature": {"avg": 40.0, "min": 40.0, "max": 40.0, "count": 1}},
                "bmp280": {"pressure": {"avg": 1010.0, "min": 1010.0, "max": 1010.0, "count": 1}}}

            # Daily buckets start at local midnight: 03:00Z for UTC-3.
            local = await aggregate_telemetry(session, history_rows.device_id, START, END, DAY, -180)
            assert [item["time"] for item in local] == [_utc("2026-03-02T03:00:00Z"), _utc("2026-03-03T03:00:00Z")]
            assert local[0]["values"]["dht22"]["temperature"] == {"avg": 20.0, "min": 10.0, "max": 30.0, "count": 3}
            assert local[1]["values"]["dht22"]["temperature"]["count"] == 1
            utc_days = await aggregate_telemetry(session, history_rows.device_id, START, END, DAY, 0)
            assert [item["time"] for item in utc_days] == [_utc("2026-03-02T00:00:00Z"), _utc("2026-03-03T00:00:00Z")]
            assert utc_days[1]["values"]["dht22"]["temperature"]["count"] == 2

            # Six-hour buckets are aligned to local midnight too (00/06/12/18 local).
            six = await aggregate_telemetry(session, history_rows.device_id, START, END, 6 * HOUR, -180)
            assert [item["time"] for item in six] == [_utc("2026-03-02T21:00:00Z"), _utc("2026-03-03T03:00:00Z")]

            narrowed = await aggregate_telemetry(session, history_rows.device_id, START, END, HOUR,
                access_start=_utc("2026-03-03T00:00:00Z"))
            assert [item["time"] for item in narrowed] == [_utc("2026-03-03T00:00:00Z"), _utc("2026-03-03T03:00:00Z")]

            await session.rollback()
            await _identity(session, history_rows.new_owner_id)
            assert await aggregate_telemetry(session, history_rows.device_id, START, END, HOUR) == []
    finally:
        async with admin.begin() as connection:
            await connection.execute(text('DELETE FROM telemetry WHERE id = ANY(:ids)'), {"ids": ids})
        await refresh_hourly(postgres_rls_config.admin_url, START, END)
        await admin.dispose()
