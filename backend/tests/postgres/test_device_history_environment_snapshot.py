"""PostgreSQL regression coverage for write-time device-history ownership."""

import uuid
from datetime import datetime, timedelta, timezone
from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.device.device_type.models import DeviceTypeCatalog
from app.api.device.models import Device, DeviceStatus
from app.api.device.operations.models import (
    DeviceOperation,
    DeviceOperationStatus,
    DeviceOperationType,
)
from app.api.device.operations.service import DeviceOperationService
from app.api.device.history.service import DeviceHistoryService
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.api.sensor.repository import SensorRepository
from app.api.sensor.models import SensorReading
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


async def test_history_api_scope_uses_snapshot_not_current_device(
    postgres_rls_config, rls_engine_factory, history_rows: HistoryRows,
) -> None:
    """A former owner keeps both histories; the new owner cannot inherit either."""
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        old_reading = await SensorService(SensorRepository(session)).save_reading(
            device_id=history_rows.device_id, device_serial=history_rows.device_serial,
            temperature_c=18.0,
        )
        old_operation = await DeviceOperationService(session).create_operation(
            operation_type=DeviceOperationType.SENSOR_DATA,
            device_serial=history_rows.device_serial,
            status=DeviceOperationStatus.SUCCESS,
        )
        await session.execute(text("UPDATE device SET environment_id = :env WHERE id = :id"),
                              {"env": history_rows.new_environment_id,
                               "id": history_rows.device_id})
        await session.commit()
        new_reading = await SensorService(SensorRepository(session)).save_reading(
            device_id=history_rows.device_id, device_serial=history_rows.device_serial,
            temperature_c=26.0,
        )
        new_operation = await DeviceOperationService(session).create_operation(
            operation_type=DeviceOperationType.KEEP_ACTIVE,
            device_serial=history_rows.device_serial,
            status=DeviceOperationStatus.SUCCESS,
        )
    await admin_engine.dispose()

    role_engine = rls_engine_factory(pool_size=1)
    async def read_as(user_id, *, admin=False):
        async with AsyncSession(role_engine, expire_on_commit=False) as session:
            await session.execute(text("SELECT set_config('app.current_user_id', :uid, true)"),
                                  {"uid": "system_admin" if admin else str(user_id)})
            user = User(id=user_id, email=f"{user_id}@example.com", username=str(user_id),
                        password="unused", is_admin=admin)
            service = DeviceHistoryService(session)
            scope = await service.resolve_scope(user)
            listed = await service.list_devices(user, only_former=False,
                                                search=history_rows.device_serial)
            former = (await service.list_devices(user,
                search=history_rows.device_serial)) if user_id == history_rows.old_owner_id else None
            filtered = (await service.list_devices(
                user, only_former=False, search=history_rows.device_serial,
                owner_id=history_rows.old_owner_id)) if admin else None
            readings = await service.list_sensor_readings(scope, serial=history_rows.device_serial)
            operations = await service.list_operations(scope, serial=history_rows.device_serial)
            return listed, {item.id for item in readings["items"]}, {item.id for item in operations["items"]}, filtered, former

    old_list, old_readings, old_operations, _, former = await read_as(history_rows.old_owner_id)
    assert any(item["serial"] == history_rows.device_serial and item["is_former"]
               for item in old_list["items"])
    assert former is not None and former["total"] == 1
    assert old_reading.id in old_readings and new_reading.id not in old_readings
    assert old_operation.id in old_operations and new_operation.id not in old_operations

    _, new_readings, new_operations, _, _ = await read_as(history_rows.new_owner_id)
    assert new_reading.id in new_readings and old_reading.id not in new_readings
    assert new_operation.id in new_operations and old_operation.id not in new_operations

    unrelated_list, unrelated_readings, unrelated_operations, _, _ = await read_as(uuid.uuid4())
    assert not any(item["serial"] == history_rows.device_serial for item in unrelated_list["items"])
    assert not unrelated_readings and not unrelated_operations

    admin_list, admin_readings, admin_operations, filtered, _ = await read_as(uuid.uuid4(), admin=True)
    assert {old_reading.id, new_reading.id} <= admin_readings
    assert {old_operation.id, new_operation.id} <= admin_operations
    assert any(item["owner_id"] == history_rows.old_owner_id for item in admin_list["items"])
    assert filtered is not None and filtered["total"] == 1
    assert filtered["items"][0]["environment_id"] == history_rows.old_environment_id


async def test_history_environment_guest_sees_operations_but_not_telemetry(
    postgres_rls_config, rls_engine_factory, history_rows: HistoryRows,
) -> None:
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    suffix = uuid.uuid4().hex
    guest = User(email=f"history-guest-{suffix}@example.com", username=f"history-guest-{suffix}",
                 password="unused")
    relation = ScopedGuestRelation(
        owner_user_id=history_rows.old_owner_id, guest_user_id=guest.id,
        scope_type=ScopeType.ENVIRONMENT, scope_id=history_rows.old_environment_id,
        access_starts_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    try:
        async with AsyncSession(admin_engine, expire_on_commit=False) as session:
            session.add(guest)
            await session.flush()
            session.add(relation)
            await session.commit()
            reading = await SensorService(SensorRepository(session)).save_reading(
                device_id=history_rows.device_id, device_serial=history_rows.device_serial,
                temperature_c=19.0,
            )
            operation = await DeviceOperationService(session).create_operation(
                operation_type=DeviceOperationType.SENSOR_DATA,
                device_serial=history_rows.device_serial,
                status=DeviceOperationStatus.SUCCESS,
            )

        role_engine = rls_engine_factory(pool_size=1)
        async with AsyncSession(role_engine, expire_on_commit=False) as session:
            await session.execute(text("SELECT set_config('app.current_user_id', :uid, true)"),
                                  {"uid": str(guest.id)})
            service = DeviceHistoryService(session)
            scope = await service.resolve_scope(guest)
            listed = await service.list_devices(guest, only_former=False,
                                                search=history_rows.device_serial)
            operations = await service.list_operations(scope, serial=history_rows.device_serial)
            readings = await service.list_sensor_readings(scope, serial=history_rows.device_serial)
            assert any(item["serial"] == history_rows.device_serial for item in listed["items"])
            assert operation.id in {item.id for item in operations["items"]}
            assert reading.id not in {item.id for item in readings["items"]}
    finally:
        async with admin_engine.begin() as connection:
            await connection.execute(text("DELETE FROM scoped_guest_relation WHERE id = :id"),
                                     {"id": relation.id})
            await connection.execute(text('DELETE FROM "user" WHERE id = :id'),
                                     {"id": guest.id})
        await admin_engine.dispose()


async def test_detail_date_range_uses_local_day_before_count_and_pagination(
    postgres_rls_config, rls_engine_factory, history_rows: HistoryRows,
) -> None:
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    instants = [datetime(2026, 9, 1, 21, 59, tzinfo=timezone.utc),
                datetime(2026, 9, 1, 22, 0, tzinfo=timezone.utc),
                datetime(2026, 9, 2, 21, 59, tzinfo=timezone.utc),
                datetime(2026, 9, 2, 22, 0, tzinfo=timezone.utc)]
    reading_ids = []
    operation_ids = []
    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        for instant in instants:
            reading = SensorReading(
                time=instant, device_id=history_rows.device_id,
                device_serial=history_rows.device_serial,
                environment_id=history_rows.old_environment_id,
                temperature_c=20.0,
            )
            operation = DeviceOperation(
                time=instant, environment_id=history_rows.old_environment_id,
                operation_type=DeviceOperationType.SENSOR_DATA,
                device_serial=history_rows.device_serial,
                status=DeviceOperationStatus.SUCCESS,
            )
            session.add_all([reading, operation])
            reading_ids.append(reading.id)
            operation_ids.append(operation.id)
        await session.commit()
    await admin_engine.dispose()

    role_engine = rls_engine_factory(pool_size=1)
    async with AsyncSession(role_engine, expire_on_commit=False) as session:
        await session.execute(text("SELECT set_config('app.current_user_id', :uid, true)"),
                              {"uid": str(history_rows.old_owner_id)})
        service = DeviceHistoryService(session)
        scope = await service.resolve_scope(User(
            id=history_rows.old_owner_id, email="owner@example.com", username="owner", password="unused"))
        for fetch, expected_ids in ((service.list_sensor_readings, reading_ids),
                                    (service.list_operations, operation_ids)):
            first = await fetch(scope, serial=history_rows.device_serial,
                                date_from=datetime(2026, 9, 2).date(), date_to=datetime(2026, 9, 2).date(),
                                utc_offset_minutes=120, page=1, per_page=1)
            second = await fetch(scope, serial=history_rows.device_serial,
                                 date_from=datetime(2026, 9, 2).date(), date_to=datetime(2026, 9, 2).date(),
                                 utc_offset_minutes=120, page=2, per_page=1)
            assert first["total"] == second["total"] == 2
            assert first["pages"] == second["pages"] == 2
            assert {first["items"][0].id, second["items"][0].id} == set(expected_ids[1:3])


async def test_is_former_is_per_snapshot_environment_under_rls(
    postgres_rls_config, rls_engine_factory, history_rows: HistoryRows,
) -> None:
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        await SensorService(SensorRepository(session)).save_reading(
            device_id=history_rows.device_id, device_serial=history_rows.device_serial,
            temperature_c=20.0,
        )
        await session.commit()

    async def listed_as_old_owner(*, only_former=True):
        role_engine = rls_engine_factory(pool_size=1)
        async with AsyncSession(role_engine, expire_on_commit=False) as session:
            await session.execute(text("SELECT set_config('app.current_user_id', :uid, true)"),
                                  {"uid": str(history_rows.old_owner_id)})
            user = User(id=history_rows.old_owner_id, email="owner@example.com",
                        username="owner", password="unused")
            result = await DeviceHistoryService(session).list_devices(
                user, only_former=only_former, search=history_rows.device_serial)
        await role_engine.dispose()
        return {item["environment_id"]: item for item in result["items"]}

    try:
        async with admin_engine.begin() as connection:
            await connection.execute(text("UPDATE device SET environment_id = NULL WHERE id = :id"),
                                     {"id": history_rows.device_id})
        unlinked = await listed_as_old_owner()
        assert unlinked[history_rows.old_environment_id]["is_former"] is True

        async with admin_engine.begin() as connection:
            await connection.execute(text("UPDATE device SET environment_id = :env WHERE id = :id"),
                                     {"env": history_rows.new_environment_id, "id": history_rows.device_id})
        moved_other_owner = await listed_as_old_owner()
        assert moved_other_owner[history_rows.old_environment_id]["is_former"] is True

        async with AsyncSession(admin_engine, expire_on_commit=False) as session:
            await SensorService(SensorRepository(session)).save_reading(
                device_id=history_rows.device_id, device_serial=history_rows.device_serial,
                temperature_c=21.0,
            )
            await session.execute(text("UPDATE environmentuser SET user_id = :owner WHERE environment_id = :env"),
                                  {"owner": history_rows.old_owner_id,
                                   "env": history_rows.new_environment_id})
            await session.commit()
        moved_same_owner = await listed_as_old_owner()
        assert moved_same_owner[history_rows.old_environment_id]["is_former"] is True
        assert history_rows.new_environment_id not in moved_same_owner
        all_entries = await listed_as_old_owner(only_former=False)
        assert all_entries[history_rows.old_environment_id]["is_former"] is True
        assert all_entries[history_rows.new_environment_id]["is_former"] is False
    finally:
        await admin_engine.dispose()
