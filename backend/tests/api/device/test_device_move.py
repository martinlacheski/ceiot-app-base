"""Move a paired device to another establishment (item 6).

One conditional UPDATE, never passing through NULL: history rows written before
the move stay attributed to the origin environment (write-time snapshot +
trigger, migration 0003); rows written after belong to the destination.
"""

import uuid
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.auth.models import User
from app.api.device.models import Device, DeviceStatus
from app.api.device.permissions import DevicePermissions
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.core.security import create_access_token


def make_token(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


def seed_move_graph(session: Session):
    country = LocationCountry(name="AR Move Context")
    session.add(country)
    session.commit()
    session.refresh(country)

    state = LocationState(name="BA Move", country_id=country.id)
    session.add(state)
    session.commit()
    session.refresh(state)

    city = LocationCity(name="Move City", postal_code="1901", state_id=state.id)
    session.add(city)
    session.commit()
    session.refresh(city)

    env_type = EnvironmentType(name="Move Type")
    session.add(env_type)
    session.commit()
    session.refresh(env_type)

    owner = User(
        email="owner-move@example.com",
        username="owner_move",
        password="x",
        permissions=[DevicePermissions.READ, DevicePermissions.PAIR],
    )
    other_owner = User(
        email="other-owner-move@example.com",
        username="other_owner_move",
        password="x",
        permissions=[DevicePermissions.READ, DevicePermissions.PAIR],
    )
    guest = User(
        email="guest-move@example.com",
        username="guest_move",
        password="x",
        permissions=[DevicePermissions.PAIR],
    )
    admin = User(
        email="admin-move@example.com",
        username="admin_move",
        password="x",
        permissions=[DevicePermissions.READ, DevicePermissions.PAIR, DevicePermissions.READ_ALL],
        is_admin=True,
    )
    session.add_all([owner, other_owner, guest, admin])
    session.commit()
    for user in (owner, other_owner, guest, admin):
        session.refresh(user)

    origin_env = Environment(
        name="Origin Env",
        address="Street 1",
        location="Hall",
        description="Origin",
        city_id=city.id,
        type_id=env_type.id,
    )
    destination_env = Environment(
        name="Destination Env",
        address="Street 2",
        location="Hall",
        description="Destination",
        city_id=city.id,
        type_id=env_type.id,
    )
    other_env = Environment(
        name="Other Env (not owned by owner)",
        address="Street 3",
        location="Hall",
        description="Other",
        city_id=city.id,
        type_id=env_type.id,
    )
    session.add_all([origin_env, destination_env, other_env])
    session.commit()
    for env in (origin_env, destination_env, other_env):
        session.refresh(env)

    session.add_all(
        [
            EnvironmentUser(
                environment_id=origin_env.id, user_id=owner.id, is_owner=True, is_active=True
            ),
            EnvironmentUser(
                environment_id=destination_env.id, user_id=owner.id, is_owner=True, is_active=True
            ),
            EnvironmentUser(
                environment_id=other_env.id, user_id=other_owner.id, is_owner=True, is_active=True
            ),
        ]
    )
    session.commit()

    device = Device(
        serial="IOT-MOVE-0001",
        name="Movable Device",
        status=DeviceStatus.PAIRED,
        environment_id=origin_env.id,
    )
    session.add(device)
    session.commit()
    session.refresh(device)

    device_guest_relation = ScopedGuestRelation(
        owner_user_id=owner.id,
        guest_user_id=guest.id,
        scope_type=ScopeType.DEVICE,
        scope_id=device.id,
    )
    session.add(device_guest_relation)
    session.commit()
    session.refresh(device_guest_relation)

    return {
        "owner": owner,
        "other_owner": other_owner,
        "guest": guest,
        "admin": admin,
        "origin_env": origin_env,
        "destination_env": destination_env,
        "other_env": other_env,
        "device": device,
        "device_guest_relation": device_guest_relation,
    }


def _fake_system_session(async_engine):
    @asynccontextmanager
    async def factory():
        async with AsyncSession(async_engine, expire_on_commit=False) as async_session:
            yield async_session

    return factory


def test_owner_can_move_device_to_own_destination(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        "app.api.device.router.system_session", _fake_system_session(async_engine)
    )
    seed = seed_move_graph(session)
    token = make_token(seed["owner"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/move",
        headers={"Authorization": f"Bearer {token}"},
        json={"environmentId": str(seed["destination_env"].id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["environmentId"] == str(seed["destination_env"].id)

    session.expire_all()
    reloaded = session.exec(select(Device).where(Device.id == seed["device"].id)).first()
    assert reloaded.environment_id == seed["destination_env"].id
    assert reloaded.status == DeviceStatus.PAIRED


def test_move_cleans_up_only_device_scoped_guest_access(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        "app.api.device.router.system_session", _fake_system_session(async_engine)
    )
    seed = seed_move_graph(session)
    token = make_token(seed["owner"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/move",
        headers={"Authorization": f"Bearer {token}"},
        json={"environmentId": str(seed["destination_env"].id)},
    )

    assert response.status_code == 200, response.text

    session.expire_all()
    relation = session.exec(
        select(ScopedGuestRelation).where(
            ScopedGuestRelation.id == seed["device_guest_relation"].id
        )
    ).first()
    assert relation.is_active is False


def test_guest_cannot_move_device(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        "app.api.device.router.system_session", _fake_system_session(async_engine)
    )
    seed = seed_move_graph(session)
    token = make_token(seed["guest"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/move",
        headers={"Authorization": f"Bearer {token}"},
        json={"environmentId": str(seed["destination_env"].id)},
    )

    assert response.status_code == 403


def test_owner_cannot_move_device_into_establishment_they_do_not_own(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        "app.api.device.router.system_session", _fake_system_session(async_engine)
    )
    seed = seed_move_graph(session)
    token = make_token(seed["owner"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/move",
        headers={"Authorization": f"Bearer {token}"},
        json={"environmentId": str(seed["other_env"].id)},
    )

    assert response.status_code == 403


def test_admin_can_move_device_into_any_destination(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        "app.api.device.router.system_session", _fake_system_session(async_engine)
    )
    seed = seed_move_graph(session)
    token = make_token(seed["admin"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/move",
        headers={"Authorization": f"Bearer {token}"},
        json={"environmentId": str(seed["other_env"].id)},
    )

    assert response.status_code == 200, response.text
    assert response.json()["environmentId"] == str(seed["other_env"].id)


def test_move_to_same_establishment_is_conflict(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        "app.api.device.router.system_session", _fake_system_session(async_engine)
    )
    seed = seed_move_graph(session)
    token = make_token(seed["owner"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/move",
        headers={"Authorization": f"Bearer {token}"},
        json={"environmentId": str(seed["origin_env"].id)},
    )

    assert response.status_code == 409


def test_move_unpaired_device_is_conflict(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        "app.api.device.router.system_session", _fake_system_session(async_engine)
    )
    seed = seed_move_graph(session)
    seed["device"].environment_id = None
    session.add(seed["device"])
    session.commit()
    token = make_token(seed["owner"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/move",
        headers={"Authorization": f"Bearer {token}"},
        json={"environmentId": str(seed["destination_env"].id)},
    )

    assert response.status_code == 409


def test_move_nonexistent_destination_is_not_found(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        "app.api.device.router.system_session", _fake_system_session(async_engine)
    )
    seed = seed_move_graph(session)
    token = make_token(seed["owner"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/move",
        headers={"Authorization": f"Bearer {token}"},
        json={"environmentId": str(uuid.uuid4())},
    )

    assert response.status_code == 404
