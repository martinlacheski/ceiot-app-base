"""Buckets of one hour or more come from the hourly rollup and equal the raw aggregation exactly.

The raw aggregation (``_AGGREGATE_SQL``) is the reference: the rollup path must return the same
buckets, averages, extremes and counts for aligned and unaligned windows, local-midnight days and
six-hour buckets (UTC-3), and for a guest whose window starts in the middle of an hour.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.auth.models import User
from app.api.sensor_catalog import telemetry as module
from app.api.sensor_catalog.telemetry import aggregate_telemetry
from telemetry_rollup import refresh_hourly
from test_device_history_environment_snapshot import history_rows  # noqa: F401

pytestmark = pytest.mark.asyncio

HOUR, DAY = 3600, 24 * 3600
FIRST = datetime(2025, 11, 10, 0, 7, tzinfo=timezone.utc)
SEEDED = (datetime(2025, 11, 9, tzinfo=timezone.utc), datetime(2025, 11, 14, tzinfo=timezone.utc))
GUEST_FROM = datetime(2025, 11, 10, 14, 25, tzinfo=timezone.utc)
CASES = [(HOUR, 0), (HOUR, -180), (6 * HOUR, -180), (DAY, -180), (DAY, 0), (6 * HOUR, 120)]
WINDOWS = [
    (datetime(2025, 11, 10, tzinfo=timezone.utc), datetime(2025, 11, 13, tzinfo=timezone.utc)),
    (datetime(2025, 11, 10, 3, 17, 30, tzinfo=timezone.utc), datetime(2025, 11, 12, 20, 43, tzinfo=timezone.utc)),
    # Ends exactly on an hour: the rows at that instant belong to the window (end is inclusive).
    (datetime(2025, 11, 10, 9, 41, tzinfo=timezone.utc), datetime(2025, 11, 11, 15, 14, tzinfo=timezone.utc)),
]


def _values(index: int) -> str:
    temperature = round(15 + (index * 7919 % 1000) / 37, 3)
    humidity = 30 + index % 41
    extra = ',"bmp280":{"pressure":%d}' % (990 + index % 17) if index % 3 == 0 else ""
    bad = ',"dht22b":{"temperature":"n/a"},"loose":4' if index % 5 == 0 else ""
    return '{"dht22":{"temperature":%s,"relative_humidity":%d}%s%s}' % (temperature, humidity, extra, bad)


async def _seed(admin, device_id, serial):
    """One row every 37 minutes for three days, plus one exactly on an hour boundary."""
    times = [FIRST + timedelta(minutes=37 * index) for index in range(3 * 24 * 60 // 37)]
    times.append(datetime(2025, 11, 11, 15, 0, tzinfo=timezone.utc))
    async with admin.begin() as connection:
        for index, when in enumerate(times):
            await connection.execute(text('INSERT INTO telemetry (time, id, device_id, device_serial, "values") '
                                          "VALUES (:t, :id, :d, :s, CAST(:v AS jsonb))"),
                                     {"t": when, "id": uuid.uuid4(), "d": device_id, "s": serial,
                                      "v": _values(index)})


async def _identity(session, identity):
    await session.execute(text("SELECT set_config('app.current_user_id', :id, true)"), {"id": str(identity)})


async def _both(session, monkeypatch, *args, **kwargs):
    """(rollup result, raw result, SQL texts the rollup call ran)."""
    executed = []
    original = session.execute

    async def spy(statement, *a, **kw):
        executed.append(str(statement))
        return await original(statement, *a, **kw)

    monkeypatch.setattr(session, "execute", spy)
    rolled = await aggregate_telemetry(session, *args, **kwargs)
    monkeypatch.setattr(session, "execute", original)
    with monkeypatch.context() as patch:
        patch.setattr(module, "uses_hourly_rollup", lambda *_: False)
        raw = await aggregate_telemetry(session, *args, **kwargs)
    return rolled, raw, executed


async def test_rollup_equals_raw_for_hour_buckets_and_raw_serves_finer_ones(
    postgres_rls_config, rls_engine_factory, history_rows, monkeypatch  # noqa: F811
):
    admin = create_async_engine(postgres_rls_config.admin_url)
    guest = User(email=f"rollup-guest-{uuid.uuid4().hex}@example.com", username=f"rollup-{uuid.uuid4().hex}",
                 password="unused", is_verified=True)
    relation = ScopedGuestRelation(owner_user_id=history_rows.old_owner_id, guest_user_id=guest.id,
                                   scope_type=ScopeType.ENVIRONMENT, scope_id=history_rows.old_environment_id,
                                   access_starts_at=GUEST_FROM)
    await _seed(admin, history_rows.device_id, history_rows.device_serial)
    async with AsyncSession(admin, expire_on_commit=False) as setup:
        setup.add(guest)
        await setup.flush()
        setup.add(relation)
        await setup.commit()
    await refresh_hourly(postgres_rls_config.admin_url, *SEEDED)
    device = history_rows.device_id
    try:
        role = rls_engine_factory()
        async with AsyncSession(role) as session:
            await _identity(session, history_rows.old_owner_id)
            for bucket, offset in CASES:
                for start, end in WINDOWS:
                    rolled, raw, executed = await _both(session, monkeypatch, device, start, end, bucket, offset)
                    assert raw, (bucket, offset, start)
                    assert rolled == raw, (bucket, offset, start, end)
                    expect_rollup = offset % 60 == 0
                    assert any("telemetry_hourly" in sql for sql in executed) is expect_rollup

            # Finer buckets, and offsets that are not whole hours, keep reading the raw rows.
            for bucket, offset in ((15 * 60, 0), (HOUR, -210)):
                rolled, raw, executed = await _both(session, monkeypatch, device, *WINDOWS[1], bucket, offset)
                assert rolled == raw and raw
                assert not any("telemetry_hourly" in sql for sql in executed)
            await session.rollback()

            # A guest's window starts mid-hour: the partial hour comes from the raw rows, and the
            # result equals the raw aggregation clipped at the same instant (as the router asks).
            await _identity(session, guest.id)
            for bucket, offset in CASES:
                rolled, raw, _ = await _both(session, monkeypatch, device, *WINDOWS[0], bucket, offset,
                                             access_start=GUEST_FROM)
                assert rolled == raw and raw, (bucket, offset)
                assert rolled[0]["time"] <= GUEST_FROM
            await session.rollback()

            # Full hours really come from the aggregate: raw rows deleted from a materialized hour
            # (no refresh) are still counted by the rollup, not by the raw path.
            hour = datetime(2025, 11, 11, 6, tzinfo=timezone.utc)
            async with admin.begin() as connection:
                removed = (await connection.execute(text(
                    "DELETE FROM telemetry_store.telemetry WHERE device_id = :d AND time >= :h "
                    "AND time < :h + interval '1 hour'"), {"d": device, "h": hour})).rowcount
            assert removed >= 1
            await _identity(session, history_rows.old_owner_id)
            rolled, raw, _ = await _both(session, monkeypatch, device, *WINDOWS[0], HOUR, 0)
            assert hour in {item["time"] for item in rolled}
            assert hour not in {item["time"] for item in raw}
            await session.rollback()
    finally:
        async with admin.begin() as connection:
            await connection.execute(text("DELETE FROM telemetry WHERE device_id = :d"), {"d": device})
            await connection.execute(text("DELETE FROM scoped_guest_relation WHERE id = :id"), {"id": relation.id})
            await connection.execute(text('DELETE FROM "user" WHERE id = :id'), {"id": guest.id})
        await refresh_hourly(postgres_rls_config.admin_url, *SEEDED)
        await admin.dispose()
