"""Run against migrated PostgreSQL/TimescaleDB with the non-bypass RLS role."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from test_device_history_environment_snapshot import history_rows


pytestmark = pytest.mark.asyncio


async def test_migrated_catalog_hypertable_trigger_and_policies(postgres_rls_config, rls_engine_factory):
    admin = create_async_engine(postgres_rls_config.admin_url)
    try:
        async with admin.connect() as connection:
            tables = set((await connection.execute(text("SELECT tablename FROM pg_tables WHERE schemaname=current_schema()"))).scalars())
            assert {"variable", "sensor", "sensor_variable", "device_sensor", "telemetry"} <= tables
            assert (await connection.execute(text("SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name='telemetry'"))).scalar_one() == 1
            # TimescaleDB replicates a hypertable's triggers onto each chunk
            # table (also non-internal), so once telemetry has chunks this
            # must be scoped to the hypertable itself, not counted globally.
            assert (await connection.execute(text(
                "SELECT count(*) FROM pg_trigger "
                "WHERE tgname='set_telemetry_environment_id' AND NOT tgisinternal "
                "AND tgrelid = 'public.telemetry'::regclass"
            ))).scalar_one() == 1
            assert (await connection.execute(text("SELECT count(*) FROM pg_class WHERE relname='telemetry' AND relrowsecurity AND relforcerowsecurity"))).scalar_one() == 1
            policies = set((await connection.execute(text("SELECT policyname FROM pg_policies WHERE tablename='telemetry'"))).scalars())
            assert {"device_data_access", "device_data_system_write"} <= policies
            assert (await connection.execute(text("SELECT is_active FROM device_type WHERE code='relay_1'"))).scalar_one() is False
            assert (await connection.execute(text("SELECT is_active FROM device_type WHERE code='environmental'"))).scalar_one() is True
        role = rls_engine_factory()
        async with AsyncSession(role) as session:
            await _identity(session, uuid.uuid4())
            assert set((await session.execute(text("SELECT code FROM variable"))).scalars()) == {"temperature", "relative_humidity", "pressure"}
            assert set((await session.execute(text("SELECT code FROM sensor"))).scalars()) == {"dht11", "dht22", "bmp280", "bme280"}
    finally:
        await admin.dispose()


async def _identity(session, identity):
    await session.execute(text("SELECT set_config('app.current_user_id', :uid, true)"), {"uid": str(identity)})


async def test_telemetry_snapshot_owner_guest_and_former_owner(postgres_rls_config, rls_engine_factory, history_rows):
    admin = create_async_engine(postgres_rls_config.admin_url)
    old_id, new_id = uuid.uuid4(), uuid.uuid4()
    try:
        async with admin.begin() as connection:
            for row_id, value in ((old_id, 21.5),):
                await connection.execute(text("INSERT INTO telemetry (id, device_id, device_serial, \"values\") VALUES (:id, :device_id, :serial, CAST(:values AS jsonb))"), {
                    "id": row_id, "device_id": history_rows.device_id, "serial": history_rows.device_serial,
                    "values": f'{{"dht22":{{"temperature":{value}}}}}',
                })
            assert (await connection.execute(text("SELECT environment_id FROM telemetry WHERE id=:id"), {"id": old_id})).scalar_one() == history_rows.old_environment_id
            await connection.execute(text("UPDATE device SET environment_id=:environment_id WHERE id=:id"), {"environment_id": history_rows.new_environment_id, "id": history_rows.device_id})
            await connection.execute(text("INSERT INTO telemetry (id, device_id, device_serial, \"values\") VALUES (:id, :device_id, :serial, '{}'::jsonb)"), {"id": new_id, "device_id": history_rows.device_id, "serial": history_rows.device_serial})
        role = rls_engine_factory()
        async with AsyncSession(role) as session:
            await _identity(session, history_rows.old_owner_id)
            assert set((await session.execute(text("SELECT id FROM telemetry WHERE id IN (:old, :new)"), {"old": old_id, "new": new_id})).scalars()) == {old_id}
            await session.rollback()
            await _identity(session, history_rows.new_owner_id)
            assert set((await session.execute(text("SELECT id FROM telemetry WHERE id IN (:old, :new)"), {"old": old_id, "new": new_id})).scalars()) == {new_id}
    finally:
        async with admin.begin() as connection:
            await connection.execute(text("DELETE FROM telemetry WHERE id IN (:old, :new)"), {"old": old_id, "new": new_id})
            await connection.execute(text("UPDATE device SET environment_id=:environment_id WHERE id=:id"), {"environment_id": history_rows.old_environment_id, "id": history_rows.device_id})
        await admin.dispose()


async def test_device_sensor_unique_key_owner_write_and_non_object_rejected(postgres_rls_config, rls_engine_factory, history_rows):
    admin = create_async_engine(postgres_rls_config.admin_url)
    role = rls_engine_factory()
    try:
        async with AsyncSession(role) as session:
            await _identity(session, history_rows.old_owner_id)
            await session.execute(text("INSERT INTO device_sensor (id, device_id, sensor_id, key, config) SELECT :id, :device_id, id, 'dht22', '{}'::jsonb FROM sensor WHERE code='dht22'"), {"id": uuid.uuid4(), "device_id": history_rows.device_id})
            await session.commit()
            await _identity(session, history_rows.new_owner_id)
            assert (await session.execute(text("SELECT count(*) FROM device_sensor WHERE device_id=:id"), {"id": history_rows.device_id})).scalar_one() == 0
        with pytest.raises(DBAPIError):
            async with admin.begin() as failed:
                await failed.execute(text("INSERT INTO device_sensor (id, device_id, sensor_id, key) SELECT :id, :device_id, id, 'dht22' FROM sensor WHERE code='dht22'"), {"id": uuid.uuid4(), "device_id": history_rows.device_id})
        with pytest.raises(DBAPIError):
            async with admin.begin() as failed:
                await failed.execute(text("INSERT INTO telemetry (id, device_id, device_serial, \"values\") VALUES (:id, :device_id, :serial, '[]'::jsonb)"), {"id": uuid.uuid4(), "device_id": history_rows.device_id, "serial": history_rows.device_serial})
    finally:
        async with admin.begin() as connection:
            await connection.execute(text("DELETE FROM device_sensor WHERE device_id=:id"), {"id": history_rows.device_id})
        await admin.dispose()


async def test_device_guest_can_read_telemetry_and_sensor_but_cannot_write(postgres_rls_config, rls_engine_factory, history_rows):
    admin = create_async_engine(postgres_rls_config.admin_url)
    guest_relation_id, telemetry_id = uuid.uuid4(), uuid.uuid4()
    try:
        async with admin.begin() as connection:
            await connection.execute(text("INSERT INTO scoped_guest_relation (id, owner_user_id, guest_user_id, scope_type, scope_id, access_starts_at, is_active, created_at) VALUES (:id, :owner, :guest, 'device', :device, :starts, true, :starts)"), {
                "id": guest_relation_id, "owner": history_rows.old_owner_id,
                "guest": history_rows.new_owner_id, "device": history_rows.device_id,
                "starts": datetime.now(timezone.utc) - timedelta(days=1),
            })
            await connection.execute(text("INSERT INTO telemetry (id, device_id, device_serial, \"values\") VALUES (:id, :device, :serial, '{}'::jsonb)"), {"id": telemetry_id, "device": history_rows.device_id, "serial": history_rows.device_serial})
            await connection.execute(text("INSERT INTO device_sensor (id, device_id, sensor_id, key) SELECT :id, :device, id, 'dht22' FROM sensor WHERE code='dht22'"), {"id": uuid.uuid4(), "device": history_rows.device_id})
        role = rls_engine_factory()
        async with AsyncSession(role) as session:
            await _identity(session, history_rows.new_owner_id)
            assert (await session.execute(text("SELECT count(*) FROM telemetry WHERE id=:id"), {"id": telemetry_id})).scalar_one() == 1
            assert (await session.execute(text("SELECT count(*) FROM device_sensor WHERE device_id=:id"), {"id": history_rows.device_id})).scalar_one() == 1
            with pytest.raises(DBAPIError):
                await session.execute(text("INSERT INTO device_sensor (id, device_id, sensor_id, key) SELECT :id, :device, id, 'bmp280' FROM sensor WHERE code='bmp280'"), {"id": uuid.uuid4(), "device": history_rows.device_id})
            await session.rollback()
    finally:
        async with admin.begin() as connection:
            await connection.execute(text("DELETE FROM telemetry WHERE id=:id"), {"id": telemetry_id})
            await connection.execute(text("DELETE FROM device_sensor WHERE device_id=:id"), {"id": history_rows.device_id})
            await connection.execute(text("DELETE FROM scoped_guest_relation WHERE id=:id"), {"id": guest_relation_id})
        await admin.dispose()
