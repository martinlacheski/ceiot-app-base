"""PostgreSQL coverage for literal metacharacters in existing list searches."""

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
from app.api.device.device_type.repository import DeviceTypeRepository
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment.repository import EnvironmentRepository
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState


pytestmark = pytest.mark.asyncio


@dataclass(frozen=True)
class SearchPatternRows:
    suffix: str
    environment_ids: dict[str, uuid.UUID]
    device_type_ids: dict[str, uuid.UUID]


@pytest_asyncio.fixture
async def search_pattern_rows(postgres_rls_config) -> AsyncIterator[SearchPatternRows]:
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    suffix = uuid.uuid4().hex

    country = LocationCountry(name=f"Search safety country {suffix}")
    state = LocationState(name=f"Search safety state {suffix}", country_id=country.id)
    city = LocationCity(
        name=f"Search safety city {suffix}",
        postal_code=suffix[:8],
        state_id=state.id,
    )
    environment_type = EnvironmentType(name=f"Search safety environment type {suffix}")
    owner = User(
        email=f"search-safety-{suffix}@example.com",
        username=f"search-safety-{suffix}",
        password="not-used-by-this-test",
        is_verified=True,
    )

    environment_ids: dict[str, uuid.UUID] = {}
    environments: list[Environment] = []
    memberships: list[EnvironmentUser] = []
    device_type_ids: dict[str, uuid.UUID] = {}
    device_types: list[DeviceTypeCatalog] = []

    for marker, substitute in (("%", "X"), ("_", "Y")):
        environment_target = Environment(
            name=f"Environment {suffix}{marker}Needle",
            address="Literal search target",
            location="Literal search target",
            description="Literal search target",
            city_id=city.id,
            type_id=environment_type.id,
        )
        environment_decoy = Environment(
            name=f"Environment {suffix}{substitute}Needle",
            address="Literal search decoy",
            location="Literal search decoy",
            description="Literal search decoy",
            city_id=city.id,
            type_id=environment_type.id,
        )
        environments.extend((environment_target, environment_decoy))
        environment_ids[marker] = environment_target.id

        device_type_target = DeviceTypeCatalog(
            name=f"Device type {suffix}{marker}Needle",
            code=f"search-target-{ord(marker)}-{suffix}",
        )
        device_type_decoy = DeviceTypeCatalog(
            name=f"Device type {suffix}{substitute}Needle",
            code=f"search-decoy-{ord(marker)}-{suffix}",
        )
        device_types.extend((device_type_target, device_type_decoy))
        device_type_ids[marker] = device_type_target.id

    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        session.add(country)
        await session.flush()
        session.add(state)
        await session.flush()
        session.add_all([city, environment_type, owner, *device_types])
        await session.flush()
        session.add_all(environments)
        await session.flush()
        for environment in environments:
            membership = EnvironmentUser(
                environment_id=environment.id,
                user_id=owner.id,
                is_owner=True,
            )
            memberships.append(membership)
        session.add_all(memberships)
        await session.commit()

    try:
        yield SearchPatternRows(
            suffix=suffix,
            environment_ids=environment_ids,
            device_type_ids=device_type_ids,
        )
    finally:
        async with admin_engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM environmentuser WHERE id = ANY(:ids)"),
                {"ids": [membership.id for membership in memberships]},
            )
            await connection.execute(
                text("DELETE FROM environment WHERE id = ANY(:ids)"),
                {"ids": [environment.id for environment in environments]},
            )
            await connection.execute(
                text("DELETE FROM device_type WHERE id = ANY(:ids)"),
                {"ids": [device_type.id for device_type in device_types]},
            )
            await connection.execute(
                text('DELETE FROM "user" WHERE id = :id'),
                {"id": owner.id},
            )
            await connection.execute(
                text("DELETE FROM locationcity WHERE id = :id"),
                {"id": city.id},
            )
            await connection.execute(
                text("DELETE FROM locationstate WHERE id = :id"),
                {"id": state.id},
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


@pytest.mark.parametrize("marker", ["%", "_"])
async def test_environment_search_treats_like_metacharacters_literally(
    postgres_rls_config,
    search_pattern_rows: SearchPatternRows,
    marker: str,
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            result = await EnvironmentRepository(session).get_all(
                page=1,
                per_page=10,
                is_active=None,
                search=f"{search_pattern_rows.suffix}{marker}Needle",
            )
    finally:
        await engine.dispose()

    assert result["total"] == 1
    assert [item.id for item in result["items"]] == [
        search_pattern_rows.environment_ids[marker]
    ]


@pytest.mark.parametrize("marker", ["%", "_"])
async def test_device_type_search_treats_like_metacharacters_literally(
    postgres_rls_config,
    search_pattern_rows: SearchPatternRows,
    marker: str,
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            result = await DeviceTypeRepository(session).get_all(
                page=1,
                per_page=10,
                is_active=None,
                search=f"{search_pattern_rows.suffix}{marker}Needle",
            )
    finally:
        await engine.dispose()

    assert result["total"] == 1
    assert [item.id for item in result["items"]] == [
        search_pattern_rows.device_type_ids[marker]
    ]
