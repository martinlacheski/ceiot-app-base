"""PostgreSQL coverage for `DeviceRepository.move()` (item 6).

Complements `test_device_history_environment_snapshot.py` (which already proves
the write-time snapshot survives a raw `UPDATE device SET environment_id = ...`)
by exercising the actual `move()` code path: the conditional UPDATE, its
concurrency guard, and that RLS visibility of history rows still follows the
snapshot column rather than the device's current environment after a move.
"""

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
    DeviceOperation,
    DeviceOperationStatus,
    DeviceOperationType,
)
from app.api.device.operations.service import DeviceOperationService
from app.api.device.repository import DeviceRepository, DeviceStateChangedError
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.api.sensor.repository import SensorRepository
from app.api.sensor.service import SensorService

pytestmark = pytest.mark.asyncio


@dataclass(frozen=True)
class MoveRows:
    old_owner_id: uuid.UUID
    new_owner_id: uuid.UUID
    old_environment_id: uuid.UUID
    new_environment_id: uuid.UUID
    device_id: uuid.UUID
    device_serial: str


@pytest_asyncio.fixture
async def move_rows(postgres_rls_config) -> AsyncIterator[MoveRows]:
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    suffix = uuid.uuid4().hex

    country = LocationCountry(name=f"Move country {suffix}")
    state = LocationState(name=f"Move state {suffix}", country_id=country.id)
    city = LocationCity(name=f"Move city {suffix}", postal_code=suffix[:8], state_id=state.id)
    environment_type = EnvironmentType(name=f"Move environment type {suffix}")
    device_type = DeviceTypeCatalog(name=f"Move device type {suffix}", code=f"move-{suffix}")
    old_owner = User(
        email=f"move-old-{suffix}@example.com",
        username=f"move-old-{suffix}",
        password="not-used-by-this-test",
        is_verified=True,
    )
    new_owner = User(
        email=f"move-new-{suffix}@example.com",
        username=f"move-new-{suffix}",
        password="not-used-by-this-test",
        is_verified=True,
    )
    old_environment = Environment(
        name=f"Move old environment {suffix}",
        address="Move test address",
        location="Move test location",
        description="Owns history written before the move",
        city_id=city.id,
        type_id=environment_type.id,
    )
    new_environment = Environment(
        name=f"Move new environment {suffix}",
        address="Move test address",
        location="Move test location",
        description="Owns history written after the move",
        city_id=city.id,
        type_id=environment_type.id,
    )
    old_membership = EnvironmentUser(
        environment_id=old_environment.id, user_id=old_owner.id, is_owner=True,
    )
    new_membership = EnvironmentUser(
        environment_id=new_environment.id, user_id=new_owner.id, is_owner=True,
    )
    device = Device(
        serial=f"MOVE-{suffix}",
        name="Move snapshot device",
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

    rows = MoveRows(
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
                text("DELETE FROM telemetry WHERE device_id = :device_id"),
                {"device_id": device.id},
            )
            await connection.execute(
                text("DELETE FROM deviceoperation WHERE device_serial = :serial"),
                {"serial": device.serial},
            )
            await connection.execute(
                text("DELETE FROM device WHERE id = :device_id"), {"device_id": device.id}
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
            await connection.execute(text("DELETE FROM locationcity WHERE id = :id"), {"id": city.id})
            await connection.execute(text("DELETE FROM locationstate WHERE id = :id"), {"id": state.id})
            await connection.execute(
                text("DELETE FROM locationcountry WHERE id = :id"), {"id": country.id}
            )
            await connection.execute(
                text("DELETE FROM environmenttype WHERE id = :id"), {"id": environment_type.id}
            )
        await admin_engine.dispose()


async def _visible_operation_ids(session: AsyncSession, *, user_id: uuid.UUID) -> set[uuid.UUID]:
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"), {"uid": str(user_id)}
    )
    return set((await session.execute(text("SELECT id FROM deviceoperation"))).scalars().all())


async def test_move_snapshot_survives_repository_move(
    postgres_rls_config, rls_engine_factory, move_rows: MoveRows,
) -> None:
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)

    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        old_operation = await DeviceOperationService(session).create_operation(
            operation_type=DeviceOperationType.SENSOR_DATA,
            device_serial=move_rows.device_serial,
            status=DeviceOperationStatus.SUCCESS,
        )

        repo = DeviceRepository(session)
        db_device = await repo.get(move_rows.device_id)
        moved = await repo.move(db_device, move_rows.new_environment_id)
        assert moved.environment_id == move_rows.new_environment_id

        new_operation = await DeviceOperationService(session).create_operation(
            operation_type=DeviceOperationType.KEEP_ACTIVE,
            device_serial=move_rows.device_serial,
            status=DeviceOperationStatus.SUCCESS,
        )

        snapshots = (
            await session.execute(
                text(
                    "SELECT id, environment_id FROM deviceoperation "
                    "WHERE id IN (:old_id, :new_id)"
                ),
                {"old_id": old_operation.id, "new_id": new_operation.id},
            )
        ).all()
    await admin_engine.dispose()

    snapshot_by_id = {row.id: row.environment_id for row in snapshots}
    assert snapshot_by_id[old_operation.id] == move_rows.old_environment_id
    assert snapshot_by_id[new_operation.id] == move_rows.new_environment_id

    role_engine = rls_engine_factory(pool_size=1)
    async with AsyncSession(role_engine, expire_on_commit=False) as session:
        old_owner_ops = await _visible_operation_ids(session, user_id=move_rows.old_owner_id)
        await session.rollback()
        new_owner_ops = await _visible_operation_ids(session, user_id=move_rows.new_owner_id)

    assert old_operation.id in old_owner_ops and new_operation.id not in old_owner_ops
    assert new_operation.id in new_owner_ops and old_operation.id not in new_owner_ops


async def test_move_raises_on_concurrent_environment_change(
    postgres_rls_config, move_rows: MoveRows,
) -> None:
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        repo = DeviceRepository(session)
        db_device = await repo.get(move_rows.device_id)

        # Simulate a concurrent change: another transaction already moved the device.
        await session.execute(
            text("UPDATE device SET environment_id = :env WHERE id = :id"),
            {"env": move_rows.new_environment_id, "id": move_rows.device_id},
        )
        await session.commit()

        with pytest.raises(DeviceStateChangedError):
            # db_device still thinks it is in the old environment.
            await repo.move(db_device, move_rows.old_environment_id)
    await admin_engine.dispose()
