"""Behavior contract for removing Mercado Pago from environment workflows.

Run this module only through ``tests/access_offline_runner.py``.  The runner
installs environment, network, dotenv, provider, and email guards before pytest
or the application test configuration is imported.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest  # type: ignore[import-not-found]

from app.api.environment.environment import repository as environment_repository
from app.api.environment.environment import router as environment_router
from app.api.environment.environment import service as environment_service
from app.api.environment.environment.models import (
    Environment,
    EnvironmentCreate,
    EnvironmentRead,
    EnvironmentUpdate,
)
from app.api.environment.environment.repository import EnvironmentRepository
from app.api.location import service as location_service
from app.api.location.service import LocationService


PUBLIC_MP_FIELDS = {
    "mp_country_id",
    "mp_state_id",
    "mp_city_id",
    "mp_store_status",
    "mp_store_last_error",
    "mp_store_synced_at",
    "mp_country",
    "mp_state",
    "mp_city",
}


def normal_environment_values() -> dict[str, object]:
    return {
        "name": "Synthetic Environment",
        "address": "Synthetic Address",
        "location": "Synthetic Interior",
        "description": "Synthetic Description",
        "city_id": uuid.uuid4(),
        "type_id": uuid.uuid4(),
    }


@pytest.mark.parametrize(
    ("dto", "values"),
    [
        (EnvironmentCreate, normal_environment_values()),
        (EnvironmentUpdate, {"description": "Updated Description"}),
        (
            EnvironmentRead,
            {
                "id": uuid.uuid4(),
                **normal_environment_values(),
                "is_active": True,
                "is_public_map_visible": False,
            },
        ),
    ],
)
def test_public_environment_dtos_ignore_legacy_mp_input(dto, values):
    assert PUBLIC_MP_FIELDS.isdisjoint(dto.model_fields)

    instance = dto.model_validate(
        {
            **values,
            "mpCountryId": str(uuid.uuid4()),
            "mpStoreStatus": "synthetic-legacy-value",
            "futureProviderField": "synthetic-extra-value",
        }
    )
    serialized = instance.model_dump(by_alias=True)

    assert "mpCountryId" not in serialized
    assert "mpStoreStatus" not in serialized
    assert "futureProviderField" not in serialized


def test_environment_orm_keeps_legacy_columns_defaults_and_non_eager_relationships():
    legacy_columns = {
        "mp_country_id",
        "mp_state_id",
        "mp_city_id",
        "mp_store_status",
        "mp_store_last_error",
        "mp_store_synced_at",
    }
    assert legacy_columns.issubset(Environment.__table__.columns.keys())

    environment = Environment(**normal_environment_values())
    assert environment.mp_country_id is None
    assert environment.mp_state_id is None
    assert environment.mp_city_id is None
    assert environment.mp_store_status == "pending"
    assert environment.mp_store_last_error is None
    assert environment.mp_store_synced_at is None

    relationships = Environment.__mapper__.relationships
    for relationship_name in ("mp_country", "mp_state", "mp_city"):
        if relationship_name in relationships:
            assert relationships[relationship_name].lazy not in {"joined", "selectin"}


class LegacyReadRow:
    def __init__(self) -> None:
        self.id = uuid.uuid4()
        for name, value in normal_environment_values().items():
            setattr(self, name, value)
        self.phone = None
        self.dvem_commission_rate = None
        self.guest_commission_rate = None
        self.is_active = True
        self.is_public_map_visible = False
        self.type = None
        self.city = None
        self.owner_name = "Synthetic Owner"
        self.owner_id = uuid.uuid4()
        self.current_user_role = "owner"
        self.can_edit = True
        self.can_delete = True

    def __getattr__(self, name: str):
        if name.startswith("mp_"):
            raise AssertionError("legacy provider metadata was consumed")
        raise AttributeError(name)


def test_environment_read_mapping_does_not_consume_legacy_mp_metadata():
    mapped = EnvironmentRead.model_validate(LegacyReadRow())

    assert mapped.name == "Synthetic Environment"
    assert PUBLIC_MP_FIELDS.isdisjoint(mapped.model_dump())


class ConstructorTripwire:
    calls = 0

    def __init__(self, *_args, **_kwargs) -> None:
        type(self).calls += 1
        raise AssertionError("provider constructor was reached")


class FakeSettingsRepository:
    def __init__(self, _db) -> None:
        pass

    async def get_or_create(self):
        return SimpleNamespace(
            default_environment_dvem_commission_rate=None,
            default_environment_guest_commission_rate=None,
        )


class FakeUserRepository:
    def __init__(self, _db) -> None:
        pass

    async def get_by_id(self, _user_id):
        return SimpleNamespace(default_dvem_commission_rate=None)


def install_environment_service_tripwires(monkeypatch) -> None:
    ConstructorTripwire.calls = 0
    monkeypatch.setattr(
        environment_service,
        "MercadoPagoRepository",
        ConstructorTripwire,
        raising=False,
    )
    monkeypatch.setattr(
        environment_service,
        "MercadoPagoService",
        ConstructorTripwire,
        raising=False,
    )
    monkeypatch.setattr(
        environment_service,
        "AppSettingsRepository",
        FakeSettingsRepository,
        raising=False,
    )
    monkeypatch.setattr(
        environment_service,
        "UserRepository",
        FakeUserRepository,
        raising=False,
    )


@pytest.mark.asyncio
async def test_create_persists_normal_fields_and_owner_without_mp_provisioning(monkeypatch):
    install_environment_service_tripwires(monkeypatch)
    captured = {}

    async def capture_create(environment, *, owner_id):
        captured["environment"] = environment
        captured["owner_id"] = owner_id
        return environment

    async def return_created(_environment_id):
        return captured["environment"]

    repo = SimpleNamespace(
        db=object(),
        get_by_owner_and_name=AsyncMock(side_effect=[None, None]),
        get_by_address=AsyncMock(return_value=None),
        create=AsyncMock(side_effect=capture_create),
        get_by_id=AsyncMock(side_effect=return_created),
        save=AsyncMock(side_effect=AssertionError("provider provisioning was reached")),
    )
    service = environment_service.EnvironmentService(cast(Any, repo))
    owner_id = uuid.uuid4()
    payload = EnvironmentCreate(**normal_environment_values())

    result = await service.create(payload, user_id=owner_id)

    persisted = captured["environment"]
    assert result is persisted
    assert captured["owner_id"] == owner_id
    assert persisted.name == payload.name
    assert persisted.city_id == payload.city_id
    repo.save.assert_not_awaited()
    assert ConstructorTripwire.calls == 0


@pytest.mark.asyncio
async def test_update_preserves_ownership_and_ignores_historical_mp_metadata(monkeypatch):
    install_environment_service_tripwires(monkeypatch)
    environment_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    historical = SimpleNamespace(
        id=environment_id,
        city_id=uuid.uuid4(),
        owner_id=actor_id,
        mp_country_id=uuid.uuid4(),
        mp_state_id=uuid.uuid4(),
        mp_city_id=uuid.uuid4(),
        mp_store_status="synthetic-legacy-value",
    )
    role = SimpleNamespace(is_owner=True)
    repo = SimpleNamespace(
        db=object(),
        get_user_role=AsyncMock(return_value=role),
        get_by_id=AsyncMock(return_value=historical),
        get_by_owner_and_name=AsyncMock(return_value=None),
        get_by_address=AsyncMock(return_value=None),
        update=AsyncMock(return_value=historical),
        save=AsyncMock(side_effect=AssertionError("provider provisioning was reached")),
    )
    service = environment_service.EnvironmentService(cast(Any, repo))
    actor = SimpleNamespace(id=actor_id, permissions=[])
    payload = EnvironmentUpdate(description="Updated Description")

    result = await service.update(environment_id, payload, cast(Any, actor))

    assert result is historical
    repo.get_user_role.assert_awaited_once_with(environment_id, actor_id)
    repo.update.assert_awaited_once_with(environment_id, payload)
    repo.save.assert_not_awaited()
    assert historical.mp_store_status == "synthetic-legacy-value"
    assert ConstructorTripwire.calls == 0


def test_environment_router_removes_only_mp_retry_and_keeps_protected_crud_routes():
    routes = {
        (route.path, method): route
        for route in environment_router.router.routes
        for method in route.methods
    }
    expected = {
        ("/", "POST"),
        ("/check", "GET"),
        ("/", "GET"),
        ("/{env_id}", "GET"),
        ("/{env_id}", "PUT"),
        ("/{env_id}", "DELETE"),
    }

    assert expected.issubset(routes)
    assert all("mercadopago" not in route.path.lower() for route in routes.values())
    for key in expected:
        assert routes[key].dependant.dependencies


def eager_relationship_names(statement) -> set[str]:
    names: set[str] = set()
    for option in statement._with_options:
        for token in option.path:
            key = getattr(token, "key", None)
            if key:
                names.add(key)
    return names


class FakeStatementSession:
    def __init__(self, row=None) -> None:
        self.row = row
        self.statement = None

    async def exec(self, statement):
        self.statement = statement
        return SimpleNamespace(first=lambda: self.row)


@pytest.mark.asyncio
async def test_environment_get_by_id_does_not_eager_load_mp_geography():
    session = FakeStatementSession(row=LegacyReadRow())

    result = await EnvironmentRepository(session).get_by_id(uuid.uuid4())

    assert result is session.row
    assert {"type", "city", "users"}.issubset(eager_relationship_names(session.statement))
    assert {"mp_country", "mp_state", "mp_city"}.isdisjoint(
        eager_relationship_names(session.statement)
    )


@pytest.mark.asyncio
async def test_environment_list_query_does_not_eager_load_mp_geography(monkeypatch):
    captured = {}

    async def capture_query(**kwargs):
        captured["statement"] = kwargs["base_query"]
        return {"items": [], "total": 0, "pages": 0, "page": 1, "per_page": 10}

    monkeypatch.setattr(environment_repository, "paginate_query_async", capture_query)

    result = await EnvironmentRepository(FakeStatementSession()).get_all()

    assert result["items"] == []
    names = eager_relationship_names(captured["statement"])
    assert {"type", "city", "users"}.issubset(names)
    assert {"mp_country", "mp_state", "mp_city"}.isdisjoint(names)


class FakeGoogleResponse:
    def json(self):
        return {
            "status": "OK",
            "results": [
                {
                    "formatted_address": "Synthetic Address",
                    "types": ["street_address"],
                    "address_components": [
                        {"long_name": "Synthetic Country", "types": ["country"]},
                        {
                            "long_name": "Synthetic State",
                            "types": ["administrative_area_level_1"],
                        },
                        {"long_name": "Synthetic City", "types": ["locality"]},
                        {"long_name": "0000", "types": ["postal_code"]},
                    ],
                }
            ],
        }


class FakeGoogleClient:
    def __init__(self, *_args, **_kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, url, *, params):
        assert url == "https://maps.googleapis.com/maps/api/geocode/json"
        assert params["latlng"] == "-27.0,-55.0"
        return FakeGoogleResponse()


@pytest.mark.asyncio
async def test_location_resolution_returns_only_internal_geography(monkeypatch):
    country = SimpleNamespace(id=uuid.uuid4(), name="Synthetic Country")
    state = SimpleNamespace(id=uuid.uuid4(), name="Synthetic State")
    city = SimpleNamespace(id=uuid.uuid4(), name="Synthetic City")
    repo = SimpleNamespace(
        db=object(),
        get_country_by_name=AsyncMock(return_value=country),
        get_state_by_name=AsyncMock(return_value=state),
        get_city_by_name=AsyncMock(return_value=city),
    )
    ConstructorTripwire.calls = 0
    monkeypatch.setattr(location_service.os, "getenv", lambda _name: "synthetic-key")
    monkeypatch.setattr(location_service.httpx, "AsyncClient", FakeGoogleClient)
    monkeypatch.setattr(
        location_service,
        "MercadoPagoLocationCatalogRepository",
        ConstructorTripwire,
        raising=False,
    )
    monkeypatch.setattr(
        location_service,
        "MercadoPagoLocationCatalogService",
        ConstructorTripwire,
        raising=False,
    )
    service = LocationService(cast(Any, repo))

    result = await service.resolve_location("-27.0,-55.0")

    assert result["country_id"] == country.id
    assert result["state_id"] == state.id
    assert result["city_id"] == city.id
    assert result["address"] == "Synthetic Address"
    assert not any(key.startswith("mp_") for key in result)
    assert ConstructorTripwire.calls == 0
