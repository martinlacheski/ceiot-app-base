"""PostgreSQL coverage for device and operation list search parity."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import get_args, get_type_hints
import uuid

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.auth.models import User
from app.api.device.device_type.models import DeviceTypeCatalog
from app.api.device.models import Device, DeviceStatus
from app.api.device.operations.models import (
    DeviceOperation,
    DeviceOperationStatus,
    DeviceOperationType,
)
from app.api.device.operations.service import DeviceOperationService
from app.api.device.operations.router import get_device_operations
from app.api.device.operations import router as operations_router_module
from app.api.device.repository import DeviceRepository
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment.repository import EnvironmentRepository
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.core.security import create_access_token

pytestmark = pytest.mark.asyncio


@dataclass(frozen=True)
class SearchGraph:
    owner_id: uuid.UUID
    other_owner_id: uuid.UUID
    guest_id: uuid.UUID
    environment_id: uuid.UUID
    target_id: uuid.UUID
    fallback_location_id: uuid.UUID
    unknown_owner_id: uuid.UUID
    literal_id: uuid.UUID
    status_ids: dict[DeviceStatus, uuid.UUID]
    enabled_ids: dict[bool, set[uuid.UUID]]
    active_ids: dict[bool, set[uuid.UUID]]
    owned_device_ids: set[uuid.UUID]
    other_device_id: uuid.UUID
    operation_ids: tuple[uuid.UUID, ...]
    operation_times: tuple[datetime, ...]


@pytest_asyncio.fixture
async def search_graph(postgres_rls_config) -> AsyncIterator[SearchGraph]:
    engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    suffix = uuid.uuid4().hex

    country = LocationCountry(name=f"Search country {suffix}")
    state = LocationState(name=f"Search state {suffix}", country_id=country.id)
    city = LocationCity(name=f"Search city {suffix}", postal_code=suffix[:8], state_id=state.id)
    environment_type = EnvironmentType(name=f"Search environment type {suffix}")
    device_type = DeviceTypeCatalog(name=f"TypeNeedle {suffix}", code=f"search-{suffix}")
    owner = User(
        email=f"search-owner-{suffix}@example.com",
        username=f"search_owner_{suffix}",
        password="unused",
        first_name="OwnerFirstNeedle",
        last_name="OwnerLastNeedle",
    )
    other_owner = User(
        email=f"search-other-{suffix}@example.com",
        username=f"search_other_{suffix}",
        password="unused",
        first_name="OwnerFirstNeedle",
        last_name="ForeignOwner",
    )
    duplicate_owner = User(
        email=f"search-duplicate-owner-{suffix}@example.com",
        username=f"search_duplicate_owner_{suffix}",
        password="unused",
        first_name="Duplicate",
        last_name="Owner",
    )
    guest = User(
        email=f"search-guest-{suffix}@example.com",
        username=f"search_guest_{suffix}",
        password="unused",
        first_name="Guest",
        last_name="Viewer",
    )
    environment = Environment(
        name="EnvironmentNeedle",
        address="Search address",
        location="FallbackLocationNeedle",
        description="Search environment",
        city_id=city.id,
        type_id=environment_type.id,
    )
    other_environment = Environment(
        name="Other environment",
        address="Other address",
        location="Other location",
        description="Other environment",
        city_id=city.id,
        type_id=environment_type.id,
    )
    unknown_owner_environment = Environment(
        name="Unknown owner environment",
        address="Unknown owner address",
        location="Unknown owner location",
        description="Environment without an active owner",
        city_id=city.id,
        type_id=environment_type.id,
    )

    target = Device(
        serial=f"TARGET-{suffix}",
        name="NameNeedle",
        description="DescriptionNeedle",
        model="ModelNeedle",
        batch="BatchNeedle",
        manufacture_date=date(2026, 3, 14),
        status=DeviceStatus.MAINTENANCE,
        enabled=False,
        is_active=False,
        gps_latitude=12.345678,
        gps_longitude=-76.54321,
        last_connection=datetime(2026, 1, 2, 2, 30),
        environment_id=environment.id,
        device_type_id=device_type.id,
    )
    fallback_location = Device(
        serial=f"FALLBACK-{suffix}",
        name="Fallback device",
        status=DeviceStatus.PAIRED,
        enabled=True,
        is_active=True,
        environment_id=environment.id,
        device_type_id=device_type.id,
    )
    literal = Device(
        serial=f"LITERAL-{suffix}",
        name=r"Literal%_\Marker",
        status=DeviceStatus.NEW,
        enabled=True,
        is_active=True,
        environment_id=environment.id,
        device_type_id=device_type.id,
    )
    active_status = Device(
        serial=f"ACTIVE-{suffix}",
        name="Active status device",
        status=DeviceStatus.ACTIVE,
        enabled=True,
        is_active=True,
        environment_id=environment.id,
        device_type_id=device_type.id,
    )
    unpaired_status = Device(
        serial=f"UNPAIRED-{suffix}",
        name="Unpaired status device",
        status=DeviceStatus.UNPAIRED,
        enabled=False,
        is_active=True,
        environment_id=environment.id,
        device_type_id=device_type.id,
    )
    page_devices = [
        Device(
            serial=f"PAGE-{letter}-{suffix}",
            name=f"PageNeedle {letter}",
            status=DeviceStatus.NEW,
            enabled=True,
            is_active=True,
            environment_id=environment.id,
            device_type_id=device_type.id,
        )
        for letter in ("A", "B", "C")
    ]
    other_device = Device(
        serial=f"OTHER-{suffix}",
        name="ScopeNeedle hidden",
        description="NameNeedle hidden from owner",
        status=DeviceStatus.NEW,
        environment_id=other_environment.id,
        device_type_id=device_type.id,
    )
    owned_scope_device = Device(
        serial=f"OWNED-SCOPE-{suffix}",
        name="ScopeNeedle visible",
        status=DeviceStatus.NEW,
        environment_id=environment.id,
        device_type_id=device_type.id,
    )
    unknown_owner_device = Device(
        serial=f"UNKNOWN-OWNER-{suffix}",
        name="Unknown owner device",
        status=DeviceStatus.NEW,
        environment_id=unknown_owner_environment.id,
        device_type_id=device_type.id,
    )
    operations = (
        DeviceOperation(
            id=uuid.uuid4(),
            time=datetime(2026, 1, 2, 2, 30, tzinfo=timezone.utc),
            device_serial=target.serial,
            operation_type=DeviceOperationType.SENSOR_DATA,
            status=DeviceOperationStatus.SUCCESS,
        ),
        DeviceOperation(
            id=uuid.uuid4(),
            time=datetime(2026, 1, 2, 3, 30, tzinfo=timezone.utc),
            device_serial=target.serial,
            operation_type=DeviceOperationType.KEEP_ACTIVE,
            status=DeviceOperationStatus.FAILED,
        ),
        DeviceOperation(
            id=uuid.uuid4(),
            time=datetime(2026, 1, 2, 4, 30, tzinfo=timezone.utc),
            device_serial=target.serial,
            operation_type=DeviceOperationType.ERROR,
            status=DeviceOperationStatus.PENDING,
        ),
        DeviceOperation(
            id=uuid.uuid4(),
            time=datetime(2026, 1, 2, 5, 30, tzinfo=timezone.utc),
            device_serial=target.serial,
            operation_type=DeviceOperationType.SESSION_REQUEST,
            status=DeviceOperationStatus.SUCCESS,
        ),
        DeviceOperation(
            id=uuid.uuid4(),
            time=datetime(2026, 1, 2, 6, 30, tzinfo=timezone.utc),
            device_serial=target.serial,
            operation_type=DeviceOperationType.OTHER,
            status=DeviceOperationStatus.SUCCESS,
        ),
        DeviceOperation(
            id=uuid.uuid4(),
            time=datetime(2026, 1, 2, 7, 30, tzinfo=timezone.utc),
            device_serial=other_device.serial,
            operation_type=DeviceOperationType.OTHER,
            status=DeviceOperationStatus.SUCCESS,
        ),
    )

    async with AsyncSession(engine, expire_on_commit=False) as session:
        session.add(country)
        await session.flush()
        session.add(state)
        await session.flush()
        session.add_all(
            [
                city,
                environment_type,
                device_type,
                owner,
                other_owner,
                duplicate_owner,
                guest,
            ]
        )
        await session.flush()
        session.add_all(
            [environment, other_environment, unknown_owner_environment]
        )
        await session.flush()
        session.add_all(
            [
                EnvironmentUser(environment_id=environment.id, user_id=owner.id, is_owner=True),
                EnvironmentUser(
                    environment_id=environment.id,
                    user_id=duplicate_owner.id,
                    is_owner=True,
                ),
                EnvironmentUser(
                    environment_id=other_environment.id,
                    user_id=other_owner.id,
                    is_owner=True,
                ),
                EnvironmentUser(
                    environment_id=unknown_owner_environment.id,
                    user_id=owner.id,
                    is_owner=False,
                ),
            ]
        )
        all_devices = [
            target,
            fallback_location,
            literal,
            active_status,
            unpaired_status,
            *page_devices,
            owned_scope_device,
            unknown_owner_device,
            other_device,
        ]
        session.add_all(all_devices)
        await session.flush()
        guest_relation = ScopedGuestRelation(
            owner_user_id=owner.id,
            guest_user_id=guest.id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=environment.id,
            access_starts_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
        session.add(guest_relation)
        session.add_all(operations)
        await session.commit()

    owned_devices = {
        target.id,
        fallback_location.id,
        literal.id,
        active_status.id,
        unpaired_status.id,
        *(device.id for device in page_devices),
        owned_scope_device.id,
        unknown_owner_device.id,
    }
    enabled_ids = {
        True: owned_devices - {target.id, unpaired_status.id},
        False: {target.id, unpaired_status.id},
    }
    active_ids = {True: owned_devices - {target.id}, False: {target.id}}
    graph = SearchGraph(
        owner_id=owner.id,
        other_owner_id=other_owner.id,
        guest_id=guest.id,
        environment_id=environment.id,
        target_id=target.id,
        fallback_location_id=fallback_location.id,
        unknown_owner_id=unknown_owner_device.id,
        literal_id=literal.id,
        status_ids={
            DeviceStatus.NEW: literal.id,
            DeviceStatus.PAIRED: fallback_location.id,
            DeviceStatus.ACTIVE: active_status.id,
            DeviceStatus.MAINTENANCE: target.id,
            DeviceStatus.UNPAIRED: unpaired_status.id,
        },
        enabled_ids=enabled_ids,
        active_ids=active_ids,
        owned_device_ids=owned_devices,
        other_device_id=other_device.id,
        operation_ids=tuple(operation.id for operation in operations[:5]),
        operation_times=tuple(operation.time for operation in operations[:5]),
    )

    try:
        yield graph
    finally:
        async with engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM scoped_guest_relation WHERE id = :id"),
                {"id": guest_relation.id},
            )
            await connection.execute(
                text("DELETE FROM deviceoperation WHERE id = ANY(:ids)"),
                {"ids": [operation.id for operation in operations]},
            )
            await connection.execute(
                text("DELETE FROM device WHERE id = ANY(:ids)"),
                {"ids": [device.id for device in all_devices]},
            )
            await connection.execute(
                text("DELETE FROM environmentuser WHERE environment_id = ANY(:ids)"),
                {
                    "ids": [
                        environment.id,
                        other_environment.id,
                        unknown_owner_environment.id,
                    ]
                },
            )
            await connection.execute(
                text("DELETE FROM environment WHERE id = ANY(:ids)"),
                {
                    "ids": [
                        environment.id,
                        other_environment.id,
                        unknown_owner_environment.id,
                    ]
                },
            )
            await connection.execute(
                text('DELETE FROM "user" WHERE id = ANY(:ids)'),
                {
                    "ids": [
                        owner.id,
                        other_owner.id,
                        duplicate_owner.id,
                        guest.id,
                    ]
                },
            )
            await connection.execute(
                text("DELETE FROM device_type WHERE id = :id"),
                {"id": device_type.id},
            )
            await connection.execute(
                text("DELETE FROM environmenttype WHERE id = :id"), {"id": environment_type.id}
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
        await engine.dispose()


async def _device_search(session: AsyncSession, graph: SearchGraph, search: str, **kwargs):
    return await DeviceRepository(session).get_all(
        search=search,
        user_id=graph.owner_id,
        is_active=None,
        per_page=100,
        **kwargs,
    )


@pytest.mark.parametrize(
    ("term", "expected_field"),
    [
        ("nAmEnEeDl", "target_id"),
        ("sCrIpTiOnNeEd", "target_id"),
        ("mOdElNeEd", "target_id"),
        ("bAtChNeEd", "target_id"),
        ("tArGeT-", "target_id"),
        ("tYpEnEeDl", "target_id"),
        ("vIrOnMeNtNeEd", "target_id"),
        ("oWnErFiRsTnEeDl", "target_id"),
        ("oWnErLaStNeEd", "target_id"),
        ("12.345678,-76.54321", "target_id"),
        ("14/03/2026", "target_id"),
        ("01/01/2026 23:3", "target_id"),
        ("lOcAtIoNnEeDl", "fallback_location_id"),
    ],
)
async def test_device_search_matches_each_visible_text_and_date_field(
    postgres_rls_config, search_graph: SearchGraph, term: str, expected_field: str
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await _device_search(
            session,
            search_graph,
            term,
            utc_offset_minutes=-180,
            connected_serials=frozenset({f"unused-{uuid.uuid4()}"}),
        )
    await engine.dispose()

    assert getattr(search_graph, expected_field) in {item.id for item in result["items"]}
    assert search_graph.other_device_id not in {item.id for item in result["items"]}


@pytest.mark.parametrize(
    ("term", "status"),
    [
        ("nUeV", DeviceStatus.NEW),
        ("vInCuLaD", DeviceStatus.PAIRED),
        ("aCtIv", DeviceStatus.ACTIVE),
        ("mAnTeNiMiEn", DeviceStatus.MAINTENANCE),
        ("dEsViNcUl", DeviceStatus.UNPAIRED),
    ],
)
async def test_device_search_matches_rendered_situation_labels(
    postgres_rls_config, search_graph: SearchGraph, term: str, status: DeviceStatus
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await _device_search(session, search_graph, term)
    await engine.dispose()

    assert search_graph.status_ids[status] in {item.id for item in result["items"]}


@pytest.mark.parametrize(
    ("term", "attribute", "value"),
    [("sI", "enabled_ids", True), ("nO", "enabled_ids", False),
     ("aCtIvO", "active_ids", True), ("iNaCtIvO", "active_ids", False)],
)
async def test_device_search_matches_rendered_boolean_labels(
    postgres_rls_config,
    search_graph: SearchGraph,
    term: str,
    attribute: str,
    value: bool,
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await _device_search(session, search_graph, term)
    await engine.dispose()

    assert getattr(search_graph, attribute)[value] <= {item.id for item in result["items"]}


@pytest.mark.parametrize(
    ("connected_serials", "term", "expected"),
    [
        ("target", "nLiNe", "target"),
        ("target", "fFlIn", "offline"),
        (None, "dIsPoNiBl", "all"),
    ],
)
async def test_device_search_matches_live_presence_labels(
    postgres_rls_config,
    search_graph: SearchGraph,
    connected_serials,
    term: str,
    expected: str,
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        target = await session.get(Device, search_graph.target_id)
        snapshot = None if connected_serials is None else frozenset({target.serial})
        result = await _device_search(
            session, search_graph, term, connected_serials=snapshot
        )
    await engine.dispose()

    ids = {item.id for item in result["items"]}
    if expected == "target":
        assert ids == {search_graph.target_id}
    elif expected == "offline":
        assert ids == search_graph.owned_device_ids - {search_graph.target_id}
    else:
        assert ids == search_graph.owned_device_ids


@pytest.mark.parametrize("term", ["%", "_", "\\"])
async def test_device_search_treats_like_metacharacters_literally(
    postgres_rls_config, search_graph: SearchGraph, term: str
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await _device_search(session, search_graph, term)
    await engine.dispose()

    assert {item.id for item in result["items"]} == {search_graph.literal_id}


async def test_device_search_no_match_and_pagination_are_server_side(
    postgres_rls_config, search_graph: SearchGraph
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        empty = await _device_search(session, search_graph, "definitely absent")
        page = await DeviceRepository(session).get_all(
            search="pAgEnEeDlE",
            user_id=search_graph.owner_id,
            is_active=None,
            page=2,
            per_page=1,
            sort_by="name",
            sort_order="asc",
        )
    await engine.dispose()

    assert empty["items"] == []
    assert empty["total"] == 0
    assert page["total"] == 3
    assert [item.name for item in page["items"]] == ["PageNeedle B"]


@pytest.mark.parametrize(
    ("term", "expected_field"),
    [
        ("sIn DeScRiPcIóN", "fallback_location_id"),
        ("dEsCoNoCiDo", "unknown_owner_id"),
        ("nUnCa", "fallback_location_id"),
        ("sIn ReGiStRoS", "fallback_location_id"),
    ],
)
async def test_device_search_matches_rendered_fallback_labels(
    postgres_rls_config,
    search_graph: SearchGraph,
    term: str,
    expected_field: str,
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await _device_search(session, search_graph, term)
    await engine.dispose()

    assert getattr(search_graph, expected_field) in {
        item.id for item in result["items"]
    }


async def test_duplicate_active_owner_rows_do_not_duplicate_device_pagination(
    postgres_rls_config, search_graph: SearchGraph
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        page = await DeviceRepository(session).get_all(
            search="pAgEnEeDlE",
            user_id=search_graph.owner_id,
            is_active=None,
            page=2,
            per_page=2,
            sort_by="name",
            sort_order="asc",
        )
    await engine.dispose()

    assert page["total"] == 3
    assert page["pages"] == 2
    assert [item.name for item in page["items"]] == ["PageNeedle C"]


async def test_device_search_matches_user_owner_label_and_ignores_blank_terms(
    postgres_rls_config, search_graph: SearchGraph
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        owner_label = await _device_search(session, search_graph, "yO")
        blank = await _device_search(session, search_graph, "   ")
    await engine.dispose()

    assert {item.id for item in owner_label["items"]} == (
        search_graph.owned_device_ids - {search_graph.unknown_owner_id}
    )
    assert {item.id for item in blank["items"]} == search_graph.owned_device_ids


async def test_device_search_preserves_postgres_rls_ownership(
    rls_engine_factory, search_graph: SearchGraph
) -> None:
    engine = rls_engine_factory()
    async with AsyncSession(engine, expire_on_commit=False) as session:
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(search_graph.owner_id)},
        )
        result = await _device_search(session, search_graph, "sCoPeNeEdLe")

    assert {item.id for item in result["items"]} <= search_graph.owned_device_ids
    assert search_graph.other_device_id not in {item.id for item in result["items"]}


async def test_guest_owner_name_bridge_stays_inside_rls_visible_devices(
    postgres_rls_config,
    rls_engine_factory,
    search_graph: SearchGraph,
) -> None:
    admin_engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        owner_environment_ids = await EnvironmentRepository(
            session
        ).get_owner_search_environment_ids("oWnErFiRsTnEeDlE")
    await admin_engine.dispose()

    assert search_graph.environment_id in owner_environment_ids
    role_engine = rls_engine_factory()
    async with AsyncSession(role_engine, expire_on_commit=False) as session:
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(search_graph.guest_id)},
        )
        result = await DeviceRepository(session).get_all(
            search="oWnErFiRsTnEeDlE",
            user_id=search_graph.guest_id,
            is_active=None,
            page=1,
            per_page=100,
            owner_search_environment_ids=owner_environment_ids,
        )

    ids = {item.id for item in result["items"]}
    assert search_graph.target_id in ids
    assert ids <= search_graph.owned_device_ids - {search_graph.unknown_owner_id}
    assert search_graph.other_device_id not in ids


async def _operations(
    session: AsyncSession, graph: SearchGraph, **kwargs
):
    return await DeviceOperationService(session).get_by_device(
        device_id=graph.target_id,
        page=1,
        per_page=100,
        **kwargs,
    )


async def test_operations_router_forwards_server_listing_parameters(
    monkeypatch,
) -> None:
    captured = {}

    class CapturingService:
        def __init__(self, session) -> None:
            captured["session"] = session

        async def get_by_device(self, **kwargs):
            captured.update(kwargs)
            return {"items": [], "total": 0, "page": 2, "per_page": 7, "pages": 0}

    monkeypatch.setattr(
        operations_router_module,
        "DeviceOperationService",
        CapturingService,
    )
    session = object()
    device_id = uuid.uuid4()
    current_user = User(
        email="operations-router@example.com",
        username="operations_router",
        password="unused",
        is_admin=True,
    )
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 1, 31, tzinfo=timezone.utc)

    result = await get_device_operations(
        session=session,
        device_id=device_id,
        current_user=current_user,
        page=2,
        per_page=7,
        start_date=start,
        end_date=end,
        operation_type=DeviceOperationType.ERROR,
        search="pending",
        sort_by="status",
        sort_order="asc",
        utc_offset_minutes=-180,
    )

    assert result["page"] == 2
    assert captured == {
        "session": session,
        "device_id": device_id,
        "page": 2,
        "per_page": 7,
        "start_date": start,
        "end_date": end,
        "operation_type": DeviceOperationType.ERROR,
        "access_starts_at": None,
        "search": "pending",
        "sort_by": "status",
        "sort_order": "asc",
        "utc_offset_minutes": -180,
    }


async def test_operations_router_sort_parameters_are_strict_literals() -> None:
    hints = get_type_hints(get_device_operations)

    assert set(get_args(hints["sort_by"])) == {
        "time",
        "id",
        "operation_type",
        "status",
    }
    assert set(get_args(hints["sort_order"])) == {"asc", "desc"}


@pytest.mark.parametrize(
    "query",
    ["sort_by=unsafe", "sort_order=sideways", "utc_offset_minutes=841"],
)
async def test_operations_router_rejects_invalid_server_listing_parameters(
    client: TestClient,
    test_user: User,
    query: str,
) -> None:
    token, _ = create_access_token({"id": str(test_user.id)})

    response = client.get(
        f"/api/devices/operations/by-device/{uuid.uuid4()}?{query}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "term",
    [
        "sEnSoR_dAt",
        "kEeP_aCtIv",
        "sEsSiOn_rEqUeS",
        "eRrO",
        "oThE",
        "sUcCeS",
        "fAiLe",
        "pEnDiN",
    ],
)
async def test_operation_search_matches_rendered_type_and_status_labels(
    postgres_rls_config, search_graph: SearchGraph, term: str
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await _operations(session, search_graph, search=term)
    await engine.dispose()

    assert result["total"] >= 1
    assert set(search_graph.operation_ids) & {uuid.UUID(item["id"]) for item in result["items"]}


@pytest.mark.parametrize(
    ("term", "expected_index"),
    [
        ("datos de sensores", 0),
        ("dispositivo activo", 1),
        ("solicitud de sesion", 3),
        ("exitoso", 0),
        ("fallido", 1),
        ("pendiente", 2),
    ],
)
async def test_operation_search_matches_spanish_display_labels(
    postgres_rls_config,
    search_graph: SearchGraph,
    term: str,
    expected_index: int,
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await _operations(session, search_graph, search=term)
    await engine.dispose()

    assert search_graph.operation_ids[expected_index] in {
        uuid.UUID(item["id"]) for item in result["items"]
    }


async def test_operation_search_matches_id_and_utc_shifted_displayed_time(
    postgres_rls_config, search_graph: SearchGraph
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        by_id = await _operations(
            session, search_graph, search=str(search_graph.operation_ids[0])[:12]
        )
        by_time = await _operations(
            session,
            search_graph,
            search="01/01/2026 23:3",
            utc_offset_minutes=-180,
        )
    await engine.dispose()

    assert [uuid.UUID(item["id"]) for item in by_id["items"]] == [search_graph.operation_ids[0]]
    assert [uuid.UUID(item["id"]) for item in by_time["items"]] == [search_graph.operation_ids[0]]


# Displayed type values contain a literal "_" (e.g. SENSOR_DATA), so "_" alone
# legitimately matches; "SENSO__DATA" only matches if "_" acted as a wildcard.
@pytest.mark.parametrize("term", ["%", "SENSO__DATA", "\\", "not-present"])
async def test_operation_search_returns_empty_for_literal_metacharacters_and_no_match(
    postgres_rls_config, search_graph: SearchGraph, term: str
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await _operations(session, search_graph, search=term)
    await engine.dispose()

    assert result["items"] == []
    assert result["total"] == 0


async def test_operation_search_pagination_and_date_range_are_server_side(
    postgres_rls_config, search_graph: SearchGraph
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        page = await DeviceOperationService(session).get_by_device(
            device_id=search_graph.target_id,
            search="02/01/2026",
            page=2,
            per_page=1,
            sort_by="time",
            sort_order="asc",
        )
        ranged = await _operations(
            session,
            search_graph,
            search="02/01/2026",
            start_date=datetime(2026, 1, 2, 3, 0, tzinfo=timezone.utc),
            end_date=datetime(2026, 1, 2, 4, 0, tzinfo=timezone.utc),
        )
    await engine.dispose()

    assert page["total"] == 5
    assert [uuid.UUID(item["id"]) for item in page["items"]] == [search_graph.operation_ids[1]]
    assert [uuid.UUID(item["id"]) for item in ranged["items"]] == [search_graph.operation_ids[1]]


@pytest.mark.parametrize("sort_by", ["time", "id", "operation_type", "status"])
@pytest.mark.parametrize("sort_order", ["asc", "desc"])
async def test_operation_sort_fields_and_directions_are_applied_before_pagination(
    postgres_rls_config,
    search_graph: SearchGraph,
    sort_by: str,
    sort_order: str,
) -> None:
    engine = create_async_engine(postgres_rls_config.admin_url)
    async with AsyncSession(engine, expire_on_commit=False) as session:
        result = await _operations(
            session, search_graph, sort_by=sort_by, sort_order=sort_order
        )
    await engine.dispose()

    key = {
        "time": lambda item: item["time"],
        "id": lambda item: uuid.UUID(item["id"]),
        "operation_type": lambda item: item["operation_type"].name,
        "status": lambda item: item["status"].name,
    }[sort_by]
    assert result["items"] == sorted(
        result["items"], key=key, reverse=sort_order == "desc"
    )


async def test_operation_listing_preserves_postgres_rls_and_access_start(
    rls_engine_factory, search_graph: SearchGraph
) -> None:
    engine = rls_engine_factory()
    async with AsyncSession(engine, expire_on_commit=False) as session:
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(search_graph.owner_id)},
        )
        visible = await _operations(
            session,
            search_graph,
            access_starts_at=datetime(2026, 1, 2, 3, 0, tzinfo=timezone.utc),
        )
        hidden = await DeviceOperationService(session).get_by_device(
            device_id=search_graph.other_device_id,
            page=1,
            per_page=100,
            search="oThEr",
        )

    assert {uuid.UUID(item["id"]) for item in visible["items"]} == set(
        search_graph.operation_ids[1:]
    )
    assert hidden["items"] == []
    assert hidden["total"] == 0
