"""Public-map coverage against PostgreSQL with forced row-level security."""

import uuid
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from dataclasses import dataclass

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.device_type.models import DeviceTypeCatalog
from app.api.device.models import Device, DeviceStatus
from app.api.environment.environment.models import Environment
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.core.db import get_async_session
from app.core.dependencies import get_system_session
from app.main import app

pytestmark = pytest.mark.asyncio


@dataclass(frozen=True)
class PublicMapRows:
    device_id: uuid.UUID
    environment_id: uuid.UUID
    display_name: str
    city: str
    state: str
    country: str


@pytest_asyncio.fixture
async def public_map_rows(postgres_rls_config) -> AsyncIterator[PublicMapRows]:
    admin_engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    suffix = uuid.uuid4().hex
    country = LocationCountry(name=f"Public map country {suffix}")
    state = LocationState(name=f"Public map state {suffix}", country_id=country.id)
    city = LocationCity(
        name=f"Public map city {suffix}",
        postal_code=suffix[:8],
        state_id=state.id,
    )
    environment_type = EnvironmentType(name=f"Public map type {suffix}")
    device_type = DeviceTypeCatalog(
        name=f"Public map device type {suffix}",
        code=f"public-map-{suffix}",
    )
    environment = Environment(
        name=f"Public map environment {suffix}",
        address="RLS test address",
        location="-31.4167,-64.1833",
        description="Forced-RLS public map regression",
        city_id=city.id,
        type_id=environment_type.id,
        is_active=True,
        is_public_map_visible=False,
    )
    device = Device(
        serial=f"PUBLIC-MAP-{suffix}",
        name=f"Sensitive device name {suffix}",
        environment_id=environment.id,
        device_type_id=device_type.id,
        status=DeviceStatus.PAIRED,
        enabled=True,
        is_active=True,
        broker_connected=False,
    )

    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        session.add_all([country, environment_type, device_type])
        await session.flush()
        session.add(state)
        await session.flush()
        session.add(city)
        await session.flush()
        session.add(environment)
        await session.flush()
        session.add(device)
        await session.commit()

    rows = PublicMapRows(
        device_id=device.id,
        environment_id=environment.id,
        display_name=environment.name,
        city=city.name,
        state=state.name,
        country=country.name,
    )
    try:
        yield rows
    finally:
        async with admin_engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM device WHERE id = :id"), {"id": device.id}
            )
            await connection.execute(
                text("DELETE FROM environment WHERE id = :id"), {"id": environment.id}
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
            await connection.execute(
                text('DELETE FROM "device_type" WHERE id = :id'),
                {"id": device_type.id},
            )
        await admin_engine.dispose()


def _session_override(
    role_engine, identity: str | None
) -> Callable[[], AsyncGenerator[AsyncSession, None]]:
    async def override() -> AsyncGenerator[AsyncSession, None]:
        async with role_engine.connect() as connection:
            async with AsyncSession(connection, expire_on_commit=False) as session:
                if identity is not None:
                    await session.execute(
                        text("SELECT set_config('app.current_user_id', :uid, false)"),
                        {"uid": identity},
                    )
                yield session

    return override


async def test_public_map_uses_system_session_under_forced_rls(
    rls_engine_factory,
    public_map_rows: PublicMapRows,
) -> None:
    role_engine = rls_engine_factory(pool_size=2)

    async with AsyncSession(role_engine, expire_on_commit=False) as anonymous_session:
        anonymous_result = await anonymous_session.exec(
            select(Device.id).where(Device.id == public_map_rows.device_id)
        )
        assert anonymous_result.one_or_none() is None

    app.dependency_overrides[get_async_session] = _session_override(role_engine, None)
    app.dependency_overrides[get_system_session] = _session_override(
        role_engine, "system_mqtt"
    )
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://localhost"
        ) as client:
            response = await client.get("/api/public/map/locations")
    finally:
        app.dependency_overrides.pop(get_async_session, None)
        app.dependency_overrides.pop(get_system_session, None)

    assert response.status_code == 200, response.text
    location = next(
        item for item in response.json() if item["displayName"] == public_map_rows.display_name
    )
    assert location == {
        "displayName": public_map_rows.display_name,
        "latitude": -31.4167,
        "longitude": -64.1833,
        "city": public_map_rows.city,
        "state": public_map_rows.state,
        "country": public_map_rows.country,
        "activeDeviceCount": 1,
    }
    assert set(location) == {
        "displayName",
        "latitude",
        "longitude",
        "city",
        "state",
        "country",
        "activeDeviceCount",
    }
    assert response.headers["cache-control"] == "public, max-age=60"
