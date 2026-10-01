"""A unique-constraint conflict must not drop the uncommitted RLS identity of the session.

`get_authed_session` / `get_system_session` set `app.current_user_id` with a session-level
`set_config` as their first statement and do not commit it. PostgreSQL treats that GUC change as
part of the open transaction, so a full `session.rollback()` after an `IntegrityError` reverts it
and every later RLS-protected read in the same request silently sees zero rows. The conflicting
write must therefore be isolated in a SAVEPOINT (`session.begin_nested()`).
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine
from fastapi import HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.repository import DeviceRepository
from app.api.device.models import DeviceCreate
from app.api.sensor_catalog.router import create_variable
from app.api.sensor_catalog.schemas import VariableCreate
from app.api.auth.models import User
from test_rls_identity_reset import (
    RLSRows,
    _authed_session,
    _dependency_system_session,
    _test_user,
    _visible_environment_ids,
    rls_rows,  # noqa: F401  (fixture)
    use_role_engine,  # noqa: F401  (fixture)
)

pytestmark = pytest.mark.asyncio

_UID = "SELECT current_setting('app.current_user_id', true)"


async def test_old_pattern_loses_the_identity_on_a_real_rls_connection(
    rls_engine_factory, use_role_engine, rls_rows: RLSRows  # noqa: F811
) -> None:
    """Documents the bug: a full rollback after an IntegrityError drops the identity."""
    use_role_engine(rls_engine_factory(pool_size=1))
    code = f"sp_old_{uuid.uuid4().hex[:8]}"
    async with _authed_session(_admin_user()) as first:
        first.add(_variable(code))
        await first.commit()
    async with _authed_session(_admin_user()) as session:
        assert rls_rows.system_environment_id in await _visible_environment_ids(session)
        session.add(_variable(code))
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()  # the pre-fix pattern
        assert (await session.execute(text(_UID))).scalar() in (None, "")
        assert await _visible_environment_ids(session) == set()


async def test_duplicate_variable_returns_409_and_keeps_the_identity(
    rls_engine_factory, use_role_engine, rls_rows: RLSRows  # noqa: F811
) -> None:
    use_role_engine(rls_engine_factory(pool_size=1))
    code = f"sp_new_{uuid.uuid4().hex[:8]}"
    body = VariableCreate(code=code, name="Savepoint", unit="u")
    async with _authed_session(_admin_user()) as first:
        await create_variable(body, first)
    async with _authed_session(_admin_user()) as session:
        with pytest.raises(HTTPException) as caught:
            await create_variable(body, session)
        assert caught.value.status_code == 409
        assert (await session.execute(text(_UID))).scalar() == "system_admin"
        assert rls_rows.system_environment_id in await _visible_environment_ids(session)


async def test_duplicate_device_serial_returns_422_and_keeps_the_system_identity(
    rls_engine_factory, use_role_engine, rls_rows: RLSRows  # noqa: F811
) -> None:
    use_role_engine(rls_engine_factory(pool_size=1))
    serial = f"SP-{uuid.uuid4().hex[:8]}".upper()
    async with _dependency_system_session() as first:
        await DeviceRepository(first).create_with_data(DeviceCreate(serial=serial, name=serial))
    async with _dependency_system_session() as session:
        with pytest.raises(HTTPException) as caught:
            await DeviceRepository(session).create_with_data(
                DeviceCreate(serial=serial, name=serial)
            )
        assert caught.value.status_code == 422
        assert (await session.execute(text(_UID))).scalar() == "system_mqtt"
        assert rls_rows.system_environment_id in await _visible_environment_ids(session)


def _variable(code: str):
    from app.api.sensor_catalog.models import Variable

    return Variable(code=code, name="Savepoint", unit="u")


def _admin_user() -> User:
    user_id = uuid.uuid4()
    return User(id=user_id, email=f"{user_id}@example.com", username=str(user_id),
                password="not-used-by-this-test", is_admin=True)
