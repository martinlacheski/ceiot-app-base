"""End-to-end S2 ingestion under system and owner RLS identities."""

import json
import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.service import DeviceService
from app.core.mqtt import handlers
from test_device_history_environment_snapshot import history_rows


pytestmark = pytest.mark.asyncio


async def test_ingested_telemetry_snapshots_environment_and_owner_can_read(
    postgres_rls_config, rls_engine_factory, history_rows, monkeypatch
):
    admin = create_async_engine(postgres_rls_config.admin_url)
    role = rls_engine_factory()
    device_sensor_id = uuid.uuid4()
    # DeviceRepository.get_by_serial() (used by the MQTT handler to resolve
    # the publishing device) normalizes the serial before matching. The
    # shared history_rows fixture stores a raw "HISTORY-<uuid4 hex>" serial
    # that does not round-trip through that normalization (mixed case,
    # non-IOT prefix), so publishing under it would look like an unknown
    # device. Real devices always publish under their already-normalized
    # serial (assigned by DeviceService.generate_serial()); mirror that here
    # by renaming this device to its normalized form before publishing.
    normalized_serial = DeviceService.normalize_serial(history_rows.device_serial)

    @asynccontextmanager
    async def mqtt_system_session():
        async with role.connect() as connection, AsyncSession(connection, expire_on_commit=False) as session:
            await session.execute(
                text("SELECT set_config('app.current_user_id', 'system_mqtt', false)")
            )
            yield session

    monkeypatch.setattr(handlers, "system_session", mqtt_system_session)
    try:
        async with admin.begin() as connection:
            await connection.execute(
                text("UPDATE device SET serial=:serial WHERE id=:id"),
                {"serial": normalized_serial, "id": history_rows.device_id},
            )
            await connection.execute(
                text(
                    "INSERT INTO device_sensor (id, device_id, sensor_id, key) "
                    "SELECT :id, :device_id, id, 'dht22' FROM sensor WHERE code='dht22'"
                ),
                {"id": device_sensor_id, "device_id": history_rows.device_id},
            )

        await handlers.process_sensor_message_pub(
            f"iot/devices/{normalized_serial}/telemetry",
            json.dumps({"sensors": {"dht22": {"temperature": 23.4, "pressure": 1012}}, "uptime": 30}),
        )

        async with admin.connect() as connection:
            rows = (await connection.execute(
                text('SELECT environment_id, "values" FROM telemetry WHERE device_id=:device_id'),
                {"device_id": history_rows.device_id},
            )).all()
        assert len(rows) == 1
        assert rows[0].environment_id == history_rows.old_environment_id
        assert rows[0]._mapping["values"] == {"dht22": {"temperature": 23.4}}

        async with AsyncSession(role) as owner_session:
            await owner_session.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": str(history_rows.old_owner_id)},
            )
            assert (await owner_session.execute(
                text("SELECT count(*) FROM telemetry WHERE device_id=:device_id"),
                {"device_id": history_rows.device_id},
            )).scalar_one() == 1
    finally:
        async with admin.begin() as connection:
            await connection.execute(text("DELETE FROM telemetry WHERE device_id=:id"), {"id": history_rows.device_id})
            await connection.execute(text("DELETE FROM device_sensor WHERE id=:id"), {"id": device_sensor_id})
        await admin.dispose()
