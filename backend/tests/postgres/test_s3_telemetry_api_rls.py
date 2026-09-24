"""S3 history query through a non-superuser, NOBYPASSRLS role."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.device.history.service import DeviceHistoryService, HistoryScope
from test_device_history_environment_snapshot import history_rows

pytestmark = pytest.mark.asyncio


async def _identity(session, user_id):
    await session.execute(text("SELECT set_config('app.current_user_id', :id, true)"),
                          {"id": str(user_id)})


async def test_serial_telemetry_history_respects_snapshot_member_scope_and_rls(
    postgres_rls_config, rls_engine_factory, history_rows
):
    admin = create_async_engine(postgres_rls_config.admin_url)
    first, second = uuid.uuid4(), uuid.uuid4()
    administrator = User(email=f's3-admin-{first}@example.com', username=f's3-admin-{first}',
                         password='unused', is_admin=True)
    guest_user = User(email=f's3-guest-{first}@example.com', username=f's3-guest-{first}',
                      password='unused')
    guest_relation = ScopedGuestRelation(owner_user_id=history_rows.old_owner_id,
        guest_user_id=guest_user.id, scope_type=ScopeType.ENVIRONMENT,
        scope_id=history_rows.old_environment_id,
        access_starts_at=datetime.now(timezone.utc) - timedelta(days=1))
    try:
        async with AsyncSession(admin, expire_on_commit=False) as setup:
            setup.add_all([administrator, guest_user])
            await setup.flush()
            setup.add(guest_relation)
            await setup.commit()
        async with admin.begin() as connection:
            await connection.execute(text('INSERT INTO telemetry (id, device_id, device_serial, "values") '
                'VALUES (:id, :device, :serial, CAST(:values AS jsonb))'),
                {"id": first, "device": history_rows.device_id,
                 "serial": history_rows.device_serial,
                 "values": '{"dht22":{"temperature":21.5}}'})
            await connection.execute(text('UPDATE device SET environment_id=:env WHERE id=:id'),
                {"env": history_rows.new_environment_id, "id": history_rows.device_id})
            await connection.execute(text('INSERT INTO telemetry (id, device_id, device_serial, "values") '
                'VALUES (:id, :device, :serial, CAST(:values AS jsonb))'),
                {"id": second, "device": history_rows.device_id,
                 "serial": history_rows.device_serial,
                 "values": '{"dht22":{"temperature":28.5}}'})
        role = rls_engine_factory()
        async with AsyncSession(role) as session:
            service = DeviceHistoryService(session)
            old_scope = HistoryScope(member_environment_ids=frozenset({history_rows.old_environment_id}))
            new_scope = HistoryScope(member_environment_ids=frozenset({history_rows.new_environment_id}))
            await _identity(session, history_rows.old_owner_id)
            old = await service.list_telemetry(old_scope, serial=history_rows.device_serial)
            assert old['total'] == 1
            assert old['items'][0].id == first
            filtered = await service.list_telemetry(old_scope, serial=history_rows.device_serial,
                variable='temperature', variable_min=20, variable_max=22)
            assert filtered['total'] == 1
            await session.rollback()
            await _identity(session, history_rows.new_owner_id)
            other = await service.list_telemetry(old_scope, serial=history_rows.device_serial)
            assert other['total'] == 0
            current = await service.list_telemetry(new_scope, serial=history_rows.device_serial)
            assert current['total'] == 1
            assert current['items'][0].id == second
            await session.rollback()
            await _identity(session, guest_user.id)
            assert (await session.execute(text('SELECT count(*) FROM telemetry WHERE id=:id'),
                {'id': first})).scalar_one() == 1
            guest = await service.list_telemetry(HistoryScope(guest_starts={
                history_rows.old_environment_id: guest_relation.access_starts_at
            }), serial=history_rows.device_serial)
            assert guest['total'] == 0  # guests never receive serial history
            await session.rollback()
            await _identity(session, administrator.id)
            all_rows = await service.list_telemetry(HistoryScope(unrestricted=True),
                                                    serial=history_rows.device_serial)
            assert {row.id for row in all_rows['items']} == {first, second}
    finally:
        async with admin.begin() as connection:
            await connection.execute(text('DELETE FROM telemetry WHERE id IN (:first, :second)'),
                                     {"first": first, "second": second})
            await connection.execute(text('UPDATE device SET environment_id=:env WHERE id=:id'),
                {"env": history_rows.old_environment_id, "id": history_rows.device_id})
            await connection.execute(text('DELETE FROM "user" WHERE id=:id'),
                                     {"id": administrator.id})
            await connection.execute(text('DELETE FROM scoped_guest_relation WHERE id=:id'),
                                     {"id": guest_relation.id})
            await connection.execute(text('DELETE FROM "user" WHERE id=:id'),
                                     {"id": guest_user.id})
        await admin.dispose()
