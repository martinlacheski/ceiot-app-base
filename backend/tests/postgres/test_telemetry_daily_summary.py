"""Daily telemetry aggregation in SQL: local-date buckets, per sensor/variable stats, RLS."""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.sensor_catalog.telemetry import daily_telemetry
from test_device_history_environment_snapshot import history_rows

pytestmark = pytest.mark.asyncio

START = datetime(2026, 3, 1, tzinfo=timezone.utc)
END = datetime(2026, 3, 5, tzinfo=timezone.utc)

ROWS = [
    # 2026-03-02 23:30Z is 20:30 local (UTC-3) on 03-02; 03-03 00:30Z is 21:30 local on 03-02.
    ("2026-03-02T23:30:00Z", '{"dht22":{"temperature":20.0,"relative_humidity":50},"bmp280":{"pressure":1000}}'),
    ("2026-03-03T00:30:00Z", '{"dht22":{"temperature":30.0,"relative_humidity":70}}'),
    # 03:30Z is 00:30 local on 03-03 (next local day).
    ("2026-03-03T03:30:00Z", '{"dht22":{"temperature":10.0},"bmp280":{"pressure":1010}}'),
    ("2026-03-03T04:00:00Z", '{"dht22":{"temperature":"bad"},"weird":5}'),
]


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


async def test_daily_buckets_use_local_date_and_stats_and_rls(postgres_rls_config, rls_engine_factory, history_rows):
    admin = create_async_engine(postgres_rls_config.admin_url)
    ids = await _seed(admin, history_rows.device_id, history_rows.device_serial)
    try:
        role = rls_engine_factory()
        async with AsyncSession(role) as session:
            await _identity(session, history_rows.old_owner_id)
            local = await daily_telemetry(session, history_rows.device_id, START, END, -180)
            assert [day["date"] for day in local] == ["2026-03-02", "2026-03-03"]
            first, second = local
            assert first["sensors"]["dht22"]["temperature"] == {"min": 20.0, "max": 30.0, "avg": 25.0, "count": 2}
            assert first["sensors"]["dht22"]["relative_humidity"] == {"min": 50.0, "max": 70.0, "avg": 60.0, "count": 2}
            assert first["sensors"]["bmp280"]["pressure"] == {"min": 1000.0, "max": 1000.0, "avg": 1000.0, "count": 1}
            # Non-numeric and non-object values are ignored, never fail the query.
            assert second["sensors"] == {
                "dht22": {"temperature": {"min": 10.0, "max": 10.0, "avg": 10.0, "count": 1}},
                "bmp280": {"pressure": {"min": 1010.0, "max": 1010.0, "avg": 1010.0, "count": 1}}}
            utc = await daily_telemetry(session, history_rows.device_id, START, END, 0)
            assert [day["date"] for day in utc] == ["2026-03-02", "2026-03-03"]
            assert utc[0]["sensors"]["dht22"]["temperature"]["count"] == 1
            assert utc[1]["sensors"]["dht22"]["temperature"]["count"] == 2
            narrowed = await daily_telemetry(session, history_rows.device_id, START, END, -180,
                access_start=datetime(2026, 3, 3, 1, tzinfo=timezone.utc))
            assert [day["date"] for day in narrowed] == ["2026-03-03"]
            await session.rollback()
            await _identity(session, history_rows.new_owner_id)
            assert await daily_telemetry(session, history_rows.device_id, START, END, -180) == []
    finally:
        async with admin.begin() as connection:
            await connection.execute(text('DELETE FROM telemetry WHERE id = ANY(:ids)'), {"ids": ids})
        await admin.dispose()
