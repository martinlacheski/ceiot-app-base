"""Edited catalog ranges are consumed by PostgreSQL-backed ingestion validation."""

import uuid

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.device_type.constants import DEFAULT_DEVICE_TYPE_ID
from app.api.device.models import Device, DeviceStatus
from app.api.sensor.repository import SensorRepository
from app.api.sensor.service import validate_sensor_values
from app.api.sensor_catalog.models import DeviceSensor, Sensor, SensorVariable, Variable


@pytest.mark.asyncio
async def test_edited_dht22_range_drops_value_above_new_max(postgres_rls_config):
    admin = create_async_engine(postgres_rls_config.admin_url)
    suffix = uuid.uuid4().hex[:8].upper()
    serial = f"IOT-{suffix[:4]}-{suffix[4:]}"
    try:
        async with AsyncSession(admin, expire_on_commit=False) as session:
            sensor = (await session.execute(select(Sensor).where(Sensor.code == "dht22"))).scalar_one()
            variable = (await session.execute(select(Variable).where(Variable.code == "temperature"))).scalar_one()
            association = await session.get(SensorVariable, (sensor.id, variable.id))
            assert association is not None
            assert association.max_value > 30

            device = Device(serial=serial, name="Edited range test device",
                device_type_id=DEFAULT_DEVICE_TYPE_ID, status=DeviceStatus.NEW,
                is_active=True, enabled=True, broker_connected=False)
            session.add(device)
            await session.flush()
            session.add(DeviceSensor(device_id=device.id, sensor_id=sensor.id, key="dht22"))
            association.max_value = 30
            await session.flush()

            capabilities = await SensorRepository(session).get_active_sensor_capabilities(device.id)
            assert ("dht22", "temperature", association.min_value, 30) in capabilities
            result = validate_sensor_values({"dht22": {"temperature": 31,
                "relative_humidity": 55}}, capabilities)
            assert result == {"dht22": {"relative_humidity": 55}}
            # No commit: the edited shared catalog range and test device roll back together.
            await session.rollback()
    finally:
        await admin.dispose()
