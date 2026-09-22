"""Behavioral regression tests for pooled PostgreSQL RLS identities."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.core import db as db_module
from app.core import dependencies as dependencies_module
from app.core.db import get_async_session, system_session
from app.core.dependencies import get_authed_session, get_system_session

pytestmark = pytest.mark.asyncio


@dataclass(frozen=True)
class RLSRows:
    user_id: uuid.UUID
    user_environment_id: uuid.UUID
    system_environment_id: uuid.UUID


@pytest_asyncio.fixture
async def rls_rows(postgres_rls_config) -> AsyncIterator[RLSRows]:
    """Seed one member-visible row and one row visible only to system identities."""
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    suffix = uuid.uuid4().hex

    country = LocationCountry(name=f"RLS country {suffix}")
    state = LocationState(name=f"RLS state {suffix}", country_id=country.id)
    city = LocationCity(
        name=f"RLS city {suffix}",
        postal_code=suffix[:8],
        state_id=state.id,
    )
    environment_type = EnvironmentType(name=f"RLS type {suffix}")
    user = User(
        email=f"rls-{suffix}@example.com",
        username=f"rls-{suffix}",
        password="not-used-by-this-test",
        is_verified=True,
    )
    user_environment = Environment(
        name=f"Member environment {suffix}",
        address="RLS test address",
        location="RLS test location",
        description="Visible to the member identity",
        city_id=city.id,
        type_id=environment_type.id,
    )
    system_environment = Environment(
        name=f"System environment {suffix}",
        address="RLS test address",
        location="RLS test location",
        description="Has no member and is visible only to system identities",
        city_id=city.id,
        type_id=environment_type.id,
    )
    membership = EnvironmentUser(
        environment_id=user_environment.id,
        user_id=user.id,
        is_owner=True,
        is_active=True,
    )

    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        session.add(country)
        await session.flush()
        session.add(state)
        await session.flush()
        session.add_all([city, environment_type, user])
        await session.flush()
        session.add_all([user_environment, system_environment])
        await session.flush()
        session.add(membership)
        await session.commit()

    rows = RLSRows(
        user_id=user.id,
        user_environment_id=user_environment.id,
        system_environment_id=system_environment.id,
    )

    try:
        yield rows
    finally:
        async with admin_engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM environmentuser WHERE id = :id"),
                {"id": membership.id},
            )
            await connection.execute(
                text("DELETE FROM environment WHERE id IN (:member_id, :system_id)"),
                {
                    "member_id": user_environment.id,
                    "system_id": system_environment.id,
                },
            )
            await connection.execute(
                text('DELETE FROM "user" WHERE id = :id'), {"id": user.id}
            )
            await connection.execute(
                text("DELETE FROM locationcity WHERE id = :id"), {"id": city.id}
            )
            await connection.execute(
                text("DELETE FROM locationstate WHERE id = :id"), {"id": state.id}
            )
            await connection.execute(
                text("DELETE FROM locationcountry WHERE id = :id"),
                {"id": country.id},
            )
            await connection.execute(
                text("DELETE FROM environmenttype WHERE id = :id"),
                {"id": environment_type.id},
            )
        await admin_engine.dispose()


@pytest.fixture
def use_role_engine(monkeypatch: pytest.MonkeyPatch):
    def apply(role_engine: AsyncEngine) -> None:
        monkeypatch.setattr(db_module, "async_engine", role_engine)
        monkeypatch.setattr(dependencies_module, "async_engine", role_engine)

    return apply


def _test_user(user_id: uuid.UUID) -> User:
    return User(
        id=user_id,
        email=f"{user_id}@example.com",
        username=str(user_id),
        password="not-used-by-this-test",
        is_admin=False,
    )


@asynccontextmanager
async def _anonymous_session() -> AsyncIterator[AsyncSession]:
    generator = get_async_session()
    try:
        yield await anext(generator)
    finally:
        await generator.aclose()


@asynccontextmanager
async def _authed_session(user: User) -> AsyncIterator[AsyncSession]:
    generator = get_authed_session(current_user=user)
    try:
        yield await anext(generator)
    finally:
        await generator.aclose()


@asynccontextmanager
async def _dependency_system_session() -> AsyncIterator[AsyncSession]:
    generator = get_system_session()
    try:
        yield await anext(generator)
    finally:
        await generator.aclose()


async def _visible_environment_ids(session: AsyncSession) -> set[uuid.UUID]:
    result = await session.exec(select(Environment.id))
    return set(result.all())


async def test_system_identity_is_reset_before_anonymous_pool_reuse(
    rls_engine_factory,
    use_role_engine,
    rls_rows: RLSRows,
) -> None:
    role_engine = rls_engine_factory(pool_size=1)
    use_role_engine(role_engine)

    async with system_session() as session:
        assert rls_rows.system_environment_id in await _visible_environment_ids(session)
        await session.commit()

    async with _anonymous_session() as session:
        visible_ids = await _visible_environment_ids(session)

    assert rls_rows.system_environment_id not in visible_ids
    assert rls_rows.user_environment_id not in visible_ids


async def test_authenticated_identity_is_reset_before_anonymous_pool_reuse(
    rls_engine_factory,
    use_role_engine,
    rls_rows: RLSRows,
) -> None:
    role_engine = rls_engine_factory(pool_size=1)
    use_role_engine(role_engine)

    async with _authed_session(_test_user(rls_rows.user_id)) as session:
        visible_ids = await _visible_environment_ids(session)
        assert rls_rows.user_environment_id in visible_ids
        assert rls_rows.system_environment_id not in visible_ids
        await session.commit()

    async with _anonymous_session() as session:
        visible_ids = await _visible_environment_ids(session)

    assert rls_rows.user_environment_id not in visible_ids
    assert rls_rows.system_environment_id not in visible_ids


async def test_system_identity_survives_commits_then_resets_on_return(
    rls_engine_factory,
    use_role_engine,
    rls_rows: RLSRows,
) -> None:
    role_engine = rls_engine_factory(pool_size=1)
    use_role_engine(role_engine)

    async with system_session() as session:
        for _ in range(3):
            assert rls_rows.system_environment_id in await _visible_environment_ids(
                session
            )
            await session.commit()

    async with _anonymous_session() as session:
        assert await _visible_environment_ids(session) == set()


async def test_overlapping_system_and_authenticated_sessions_do_not_cross_contaminate(
    rls_engine_factory,
    use_role_engine,
    rls_rows: RLSRows,
) -> None:
    role_engine = rls_engine_factory(pool_size=2)
    use_role_engine(role_engine)
    entered = asyncio.Barrier(2)

    async def system_visibility() -> set[uuid.UUID]:
        async with _dependency_system_session() as session:
            await entered.wait()
            visible_ids = await _visible_environment_ids(session)
            await session.commit()
            return visible_ids

    async def member_visibility() -> set[uuid.UUID]:
        async with _authed_session(_test_user(rls_rows.user_id)) as session:
            await entered.wait()
            visible_ids = await _visible_environment_ids(session)
            await session.commit()
            return visible_ids

    system_ids, member_ids = await asyncio.gather(
        system_visibility(), member_visibility()
    )

    assert rls_rows.system_environment_id in system_ids
    assert rls_rows.user_environment_id in system_ids
    assert rls_rows.user_environment_id in member_ids
    assert rls_rows.system_environment_id not in member_ids

    async def anonymous_visibility() -> set[uuid.UUID]:
        async with _anonymous_session() as session:
            return await _visible_environment_ids(session)

    first_anonymous_ids, second_anonymous_ids = await asyncio.gather(
        anonymous_visibility(), anonymous_visibility()
    )
    assert first_anonymous_ids == set()
    assert second_anonymous_ids == set()
