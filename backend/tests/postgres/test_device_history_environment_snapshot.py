"""PostgreSQL regression coverage for write-time device-history ownership."""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.api.device.device_type.models import DeviceTypeCatalog
from app.api.device.models import Device, DeviceStatus
from app.api.device.operations.models import (
    DeviceOperationStatus,
    DeviceOperationType,
)
from app.api.device.operations.service import DeviceOperationService
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.api.sensor.repository import SensorRepository
from app.api.sensor.service import SensorService

pytestmark = pytest.mark.asyncio


@dataclass(frozen=True)
class HistoryRows:
    old_owner_id: uuid.UUID
    new_owner_id: uuid.UUID
    old_environment_id: uuid.UUID
    new_environment_id: uuid.UUID
    device_id: uuid.UUID
    device_serial: str


@pytest_asyncio.fixture
async def history_rows(postgres_rls_config) -> AsyncIterator[HistoryRows]:
    """Seed two owned environments and one device in the old environment."""
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    suffix = uuid.uuid4().hex

    country = LocationCountry(name=f"History country {suffix}")
    state = LocationState(name=f"History state {suffix}", country_id=country.id)
    city = LocationCity(
        name=f"History city {suffix}",
        postal_code=suffix[:8],
        state_id=state.id,
    )
    environment_type = EnvironmentType(name=f"History environment type {suffix}")
    device_type = DeviceTypeCatalog(
        name=f"History device type {suffix}",
        code=f"history-{suffix}",
    )
    old_owner = User(
        email=f"history-old-{suffix}@example.com",
        username=f"history-old-{suffix}",
        password="not-used-by-this-test",
        is_verified=True,
    )
    new_owner = User(
        email=f"history-new-{suffix}@example.com",
        username=f"history-new-{suffix}",
        password="not-used-by-this-test",
        is_verified=True,
    )
    old_environment = Environment(
        name=f"Old environment {suffix}",
        address="History test address",
        location="History test location",
        description="Owns history written before reassignment",
        city_id=city.id,
        type_id=environment_type.id,
    )
    new_environment = Environment(
        name=f"New environment {suffix}",
        address="History test address",
        location="History test location",
        description="Owns history written after reassignment",
        city_id=city.id,
        type_id=environment_type.id,
    )
    old_membership = EnvironmentUser(
        environment_id=old_environment.id,
        user_id=old_owner.id,
        is_owner=True,
    )
    new_membership = EnvironmentUser(
        environment_id=new_environment.id,
        user_id=new_owner.id,
        is_owner=True,
    )
    device = Device(
        serial=f"HISTORY-{suffix}",
        name="History snapshot device",
        status=DeviceStatus.PAIRED,
        environment_id=old_environment.id,
        device_type_id=device_type.id,
    )

    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        session.add(country)
        await session.flush()
        session.add(state)
        await session.flush()
        session.add_all([city, environment_type, device_type, old_owner, new_owner])
        await session.flush()
        session.add_all([old_environment, new_environment])
        await session.flush()
        session.add_all([old_membership, new_membership, device])
        await session.commit()

    rows = HistoryRows(
        old_owner_id=old_owner.id,
        new_owner_id=new_owner.id,
        old_environment_id=old_environment.id,
        new_environment_id=new_environment.id,
        device_id=device.id,
        device_serial=device.serial,
    )

    try:
        yield rows
    finally:
        async with admin_engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM sensorreading WHERE device_id = :device_id"),
                {"device_id": device.id},
            )
            await connection.execute(
                text("DELETE FROM deviceoperation WHERE device_serial = :serial"),
                {"serial": device.serial},
            )
            await connection.execute(
                text("DELETE FROM device WHERE id = :device_id"),
                {"device_id": device.id},
            )
            await connection.execute(
                text("DELETE FROM environmentuser WHERE id IN (:old_id, :new_id)"),
                {"old_id": old_membership.id, "new_id": new_membership.id},
            )
            await connection.execute(
                text("DELETE FROM environment WHERE id IN (:old_id, :new_id)"),
                {"old_id": old_environment.id, "new_id": new_environment.id},
            )
            await connection.execute(
                text('DELETE FROM "user" WHERE id IN (:old_id, :new_id)'),
                {"old_id": old_owner.id, "new_id": new_owner.id},
            )
            await connection.execute(
                text("DELETE FROM device_type WHERE id = :id"), {"id": device_type.id}
            )
            await connection.execute(
                text("DELETE FROM locationcity WHERE id = :id"), {"id": city.id}
            )
            await connection.execute(
                text("DELETE FROM locationstate WHERE id = :id"), {"id": state.id}
            )
            await connection.execute(
                text("DELETE FROM locationcountry WHERE id = :id"), {"id": country.id}
            )
            await connection.execute(
                text("DELETE FROM environmenttype WHERE id = :id"),
                {"id": environment_type.id},
            )
        await admin_engine.dispose()


async def _visible_history_ids(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
) -> tuple[set[uuid.UUID], set[uuid.UUID]]:
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )
    reading_ids = set(
        (await session.execute(text("SELECT id FROM sensorreading"))).scalars().all()
    )
    operation_ids = set(
        (await session.execute(text("SELECT id FROM deviceoperation"))).scalars().all()
    )
    return reading_ids, operation_ids


async def test_history_snapshots_environment_and_survives_device_reassignment(
    postgres_rls_config,
    rls_engine_factory,
    history_rows: HistoryRows,
) -> None:
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)

    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        old_reading = await SensorService(SensorRepository(session)).save_reading(
            device_id=history_rows.device_id,
            device_serial=history_rows.device_serial,
            temperature_c=20.0,
        )
        old_operation = await DeviceOperationService(session).create_operation(
            operation_type=DeviceOperationType.SENSOR_DATA,
            device_serial=history_rows.device_serial,
            status=DeviceOperationStatus.SUCCESS,
        )

        await session.execute(
            text("UPDATE device SET environment_id = :environment_id WHERE id = :id"),
            {
                "environment_id": history_rows.new_environment_id,
                "id": history_rows.device_id,
            },
        )
        await session.commit()

        new_reading = await SensorService(SensorRepository(session)).save_reading(
            device_id=history_rows.device_id,
            device_serial=history_rows.device_serial,
            temperature_c=21.0,
        )
        new_operation = await DeviceOperationService(session).create_operation(
            operation_type=DeviceOperationType.KEEP_ACTIVE,
            device_serial=history_rows.device_serial,
            status=DeviceOperationStatus.SUCCESS,
        )

        snapshots = (
            await session.execute(
                text(
                    "SELECT 'reading', id, environment_id FROM sensorreading "
                    "WHERE id IN (:old_reading_id, :new_reading_id) "
                    "UNION ALL "
                    "SELECT 'operation', id, environment_id FROM deviceoperation "
                    "WHERE id IN (:old_operation_id, :new_operation_id)"
                ),
                {
                    "old_reading_id": old_reading.id,
                    "new_reading_id": new_reading.id,
                    "old_operation_id": old_operation.id,
                    "new_operation_id": new_operation.id,
                },
            )
        ).all()

    await admin_engine.dispose()

    snapshot_by_id = {row.id: row.environment_id for row in snapshots}
    assert snapshot_by_id[old_reading.id] == history_rows.old_environment_id
    assert snapshot_by_id[old_operation.id] == history_rows.old_environment_id
    assert snapshot_by_id[new_reading.id] == history_rows.new_environment_id
    assert snapshot_by_id[new_operation.id] == history_rows.new_environment_id

    role_engine = rls_engine_factory(pool_size=1)
    async with AsyncSession(role_engine, expire_on_commit=False) as session:
        old_readings, old_operations = await _visible_history_ids(
            session, user_id=history_rows.old_owner_id
        )
        await session.rollback()
        new_readings, new_operations = await _visible_history_ids(
            session, user_id=history_rows.new_owner_id
        )

    assert old_reading.id in old_readings
    assert new_reading.id not in old_readings
    assert old_operation.id in old_operations
    assert new_operation.id not in old_operations

    assert new_reading.id in new_readings
    assert old_reading.id not in new_readings
    assert new_operation.id in new_operations
    assert old_operation.id not in new_operations
