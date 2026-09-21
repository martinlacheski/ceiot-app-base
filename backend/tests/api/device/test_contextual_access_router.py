import uuid
from datetime import timedelta
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.access.models import InvitationStatus, ScopeType, ScopedGuestInvitation, ScopedGuestRelation
from app.api.auth.models import User
from app.api.device.models import (
    Device,
    DeviceStatus,
)
from app.api.device.repository import DeviceRepository
from app.api.device.operations.models import (
    DeviceOperation,
    DeviceOperationStatus,
    DeviceOperationType,
)
from app.api.device.permissions import DevicePermissions
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.core.security import create_access_token
from app.core.time import utc_now


class EmailServiceSpy:
    sent: list[dict[str, str]] = []

    async def send_invitation_email(
        self,
        email_to: str,
        environment_name: str,
        owner_email: str,
        invitation_id: str,
    ):
        self.sent.append(
            {
                "email_to": email_to,
                "environment_name": environment_name,
                "owner_email": owner_email,
                "invitation_id": invitation_id,
            }
        )


def make_token(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


def seed_context_graph(session: Session):
    country = LocationCountry(name="AR Device Context")
    session.add(country)
    session.commit()
    session.refresh(country)

    state = LocationState(name="BA", country_id=country.id)
    session.add(state)
    session.commit()
    session.refresh(state)

    city = LocationCity(name="La Plata", postal_code="1900", state_id=state.id)
    session.add(city)
    session.commit()
    session.refresh(city)

    env_type = EnvironmentType(name="Cafe")
    session.add(env_type)
    session.commit()
    session.refresh(env_type)

    owner = User(
        email="owner-device@example.com",
        username="owner_device",
        password="x",
        permissions=[
            DevicePermissions.READ,
            DevicePermissions.UPDATE,
            DevicePermissions.PAIR,
        ],
    )
    guest = User(
        email="guest-device@example.com",
        username="guest_device",
        password="x",
        permissions=[
            DevicePermissions.UPDATE,
            DevicePermissions.PAIR,
            "environment:read",
        ],
    )
    direct_guest = User(
        email="direct-guest-device@example.com",
        username="direct_guest_device",
        password="x",
    )
    admin = User(
        email="admin-device@example.com",
        username="admin_device",
        password="x",
        permissions=[
            DevicePermissions.READ,
            DevicePermissions.UPDATE,
            DevicePermissions.PAIR,
        ],
        is_admin=True,
    )
    session.add(owner)
    session.add(guest)
    session.add(direct_guest)
    session.add(admin)
    session.commit()
    session.refresh(owner)
    session.refresh(guest)
    session.refresh(direct_guest)
    session.refresh(admin)

    environment = Environment(
        name="Device Context Env",
        address="Street 111",
        location="Hall",
        description="Env",
        city_id=city.id,
        type_id=env_type.id,
    )
    session.add(environment)
    session.commit()
    session.refresh(environment)

    session.add(
        EnvironmentUser(
            environment_id=environment.id,
            user_id=owner.id,
            is_owner=True,
            is_active=True,
        )
    )
    session.commit()

    device = Device(
        serial="IOT-DDDD-0004",
        name="Guest Visible Device",
        status=DeviceStatus.PAIRED,
        environment_id=environment.id,
    )
    session.add(device)
    session.commit()
    session.refresh(device)

    session.add(
        ScopedGuestRelation(
            owner_user_id=owner.id,
            guest_user_id=guest.id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=environment.id,
        )
    )
    session.add(
        DeviceOperation(
            device_id=device.id,
            device_serial=device.serial,
            operation_type=DeviceOperationType.SENSOR_DATA,
            status=DeviceOperationStatus.SUCCESS,
            payload={"ok": True},
            time=utc_now(),
        )
    )
    session.commit()

    return {
        "owner": owner,
        "guest": guest,
        "direct_guest": direct_guest,
        "admin": admin,
        "environment": environment,
        "device": device,
    }


def test_guest_can_read_device_and_operations_but_cannot_manage(client: TestClient, session: Session):
    seed = seed_context_graph(session)
    token = make_token(seed["guest"].id)

    list_response = client.get(
        "/api/devices",
        headers={"Authorization": f"Bearer {token}"},
    )
    get_response = client.get(
        f"/api/devices/{seed['device'].id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    operations_response = client.get(
        f"/api/devices/operations/by-device/{seed['device'].id}?page=1&per_page=1",
        headers={"Authorization": f"Bearer {token}"},
    )
    update_response = client.put(
        f"/api/devices/{seed['device'].id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Mutated by guest"},
    )
    unpair_response = client.post(
        f"/api/devices/{seed['device'].id}/unpair",
        headers={"Authorization": f"Bearer {token}"},
    )
    seed["guest"].permissions.append(DevicePermissions.DELETE)
    session.add(seed["guest"])
    session.commit()
    delete_token = make_token(seed["guest"].id)
    delete_response = client.delete(
        f"/api/devices/{seed['device'].id}",
        headers={"Authorization": f"Bearer {delete_token}"},
    )

    assert list_response.status_code == 200
    assert list_response.json()["total"] == 1
    assert list_response.json()["items"][0]["id"] == str(seed["device"].id)
    assert get_response.status_code == 200
    assert get_response.json()["id"] == str(seed["device"].id)
    assert operations_response.status_code == 200
    operations = operations_response.json()
    assert operations["total"] == 1
    assert operations["page"] == 1
    assert operations["per_page"] == 1
    assert operations["pages"] == 1
    assert len(operations["items"]) == 1
    assert update_response.status_code == 403
    assert unpair_response.status_code == 403
    assert delete_response.status_code == 403


def test_device_context_lists_inherited_environment_guest(client: TestClient, session: Session):
    seed = seed_context_graph(session)
    token = make_token(seed["owner"].id)

    response = client.get(
        f"/api/access/devices/{seed['device'].id}/context",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert len(response.json()["guests"]) == 1
    assert response.json()["guests"][0]["guestUserId"] == str(seed["guest"].id)
    assert response.json()["guests"][0]["email"] == seed["guest"].email
    assert response.json()["guests"][0]["sourceScope"] == ScopeType.ENVIRONMENT.value


def test_guest_only_sees_device_operations_after_access_start(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    existing_operation = session.exec(select(DeviceOperation)).first()
    relation = session.exec(
        select(ScopedGuestRelation).where(
            ScopedGuestRelation.scope_type == ScopeType.ENVIRONMENT,
            ScopedGuestRelation.scope_id == seed["environment"].id,
            ScopedGuestRelation.guest_user_id == seed["guest"].id,
        )
    ).one()
    access_start = existing_operation.time + timedelta(seconds=1)
    relation.access_starts_at = access_start
    session.add(relation)
    session.add(
        DeviceOperation(
            device_id=seed["device"].id,
            device_serial=seed["device"].serial,
            operation_type=DeviceOperationType.SENSOR_DATA,
            status=DeviceOperationStatus.SUCCESS,
            payload={"after": True},
            time=access_start,
        )
    )
    session.commit()

    token = make_token(seed["guest"].id)
    response = client.get(
        f"/api/devices/operations/by-device/{seed['device'].id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1


def test_environment_guest_can_see_invited_environment_list(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    token = make_token(seed["guest"].id)

    response = client.get(
        "/api/environment/",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == str(seed["environment"].id)
    assert response.json()["items"][0]["ownerName"] == "owner_device"
    assert response.json()["items"][0]["currentUserRole"] == "guest"
    assert response.json()["items"][0]["canEdit"] is False
    assert response.json()["items"][0]["canDelete"] is False


def test_contextual_guest_without_environment_permission_can_see_environment_list(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    seed["guest"].permissions = []
    session.add(seed["guest"])
    session.commit()
    token = make_token(seed["guest"].id)

    response = client.get(
        "/api/environment/",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == str(seed["environment"].id)
    assert response.json()["items"][0]["currentUserRole"] == "guest"


def test_contextual_guest_with_read_all_permission_sees_only_invited_environment(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    other_environment = Environment(
        name="Other Owner Environment",
        address="Street 222",
        location="Other Hall",
        description="Other Env",
        city_id=seed["environment"].city_id,
        type_id=seed["environment"].type_id,
    )
    session.add(other_environment)
    session.commit()
    session.refresh(other_environment)
    session.add(
        EnvironmentUser(
            environment_id=other_environment.id,
            user_id=seed["owner"].id,
            is_owner=True,
            is_active=True,
        )
    )
    seed["guest"].permissions = ["environment:read_all"]
    session.add(seed["guest"])
    session.commit()
    token = make_token(seed["guest"].id)

    response = client.get(
        "/api/environment/",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == str(seed["environment"].id)


def test_authenticated_guest_without_environment_permission_can_read_environment_types(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    seed["guest"].permissions = []
    session.add(seed["guest"])
    session.commit()
    token = make_token(seed["guest"].id)

    response = client.get(
        "/api/environment/types/?page=1&per_page=100&is_active=true",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1


def test_device_guest_can_see_parent_environment_list(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    env_relation = session.exec(
        select(ScopedGuestRelation).where(
            ScopedGuestRelation.scope_type == ScopeType.ENVIRONMENT,
            ScopedGuestRelation.scope_id == seed["environment"].id,
            ScopedGuestRelation.guest_user_id == seed["guest"].id,
        )
    ).one()
    env_relation.is_active = False
    session.add(env_relation)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
        )
    )
    session.commit()
    token = make_token(seed["guest"].id)

    response = client.get(
        "/api/environment/",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == str(seed["environment"].id)
    assert response.json()["items"][0]["currentUserRole"] == "guest"
    assert response.json()["items"][0]["canEdit"] is False
    assert response.json()["items"][0]["canDelete"] is False


def test_owner_environment_list_reports_owner_role_and_management_flags(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    seed["owner"].permissions = ["environment:read"]
    session.add(seed["owner"])
    session.commit()
    token = make_token(seed["owner"].id)

    response = client.get(
        "/api/environment/",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["id"] == str(seed["environment"].id)
    assert response.json()["items"][0]["currentUserRole"] == "owner"
    assert response.json()["items"][0]["canEdit"] is True
    assert response.json()["items"][0]["canDelete"] is True


def test_guest_with_update_permission_cannot_update_environment(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    seed["guest"].permissions = ["environment:read", "environment:update"]
    session.add(seed["guest"])
    session.commit()
    token = make_token(seed["guest"].id)

    response = client.put(
        f"/api/environment/{seed['environment'].id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "Guest mutated env"},
    )

    assert response.status_code == 403


def test_owner_can_manage_device_guest_relations_without_financial_fields(
    client: TestClient, session: Session
):
    seed = seed_context_graph(session)
    token = make_token(seed["owner"].id)

    create_response = client.post(
        f"/api/devices/{seed['device'].id}/guests",
        headers={"Authorization": f"Bearer {token}"},
        json={"guestUserId": str(seed["direct_guest"].id)},
    )
    update_response = client.patch(
        f"/api/devices/{seed['device'].id}/guests/{seed['direct_guest'].id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"accessStartsAt": "2026-06-01"},
    )
    delete_response = client.delete(
        f"/api/devices/{seed['device'].id}/guests/{seed['direct_guest'].id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert create_response.status_code == 201
    assert create_response.json()["scopeType"] == ScopeType.DEVICE.value
    assert update_response.status_code == 200
    assert update_response.json()["accessStartsAt"] == "2026-06-01T00:00:00"
    relation = session.exec(
        select(ScopedGuestRelation).where(
            ScopedGuestRelation.scope_type == ScopeType.DEVICE,
            ScopedGuestRelation.scope_id == seed["device"].id,
            ScopedGuestRelation.guest_user_id == seed["direct_guest"].id,
        )
    ).one()
    assert delete_response.status_code == 200
    assert delete_response.json()["isActive"] is False
    assert relation.is_active is False


def test_admin_can_deactivate_device_guest_relation(client: TestClient, session: Session):
    seed = seed_context_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
        )
    )
    session.commit()
    token = make_token(seed["admin"].id)

    response = client.delete(
        f"/api/devices/{seed['device'].id}/guests/{seed['guest'].id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["guestUserId"] == str(seed["guest"].id)
    assert response.json()["isActive"] is False


def test_owner_pairs_device_without_commercial_configuration(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    @asynccontextmanager
    async def fake_system_session():
        async with AsyncSession(async_engine, expire_on_commit=False) as async_session:
            yield async_session

    monkeypatch.setattr("app.api.device.router.system_session", fake_system_session)
    seed = seed_context_graph(session)
    unpaired_device = Device(
        serial="IOT-DDDD-0005",
        name="Unpaired Device",
        status=DeviceStatus.NEW,
    )
    session.add(unpaired_device)
    session.commit()
    token = make_token(seed["owner"].id)

    response = client.post(
        "/api/devices/pair",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "serial": unpaired_device.serial,
            "environmentId": str(seed["environment"].id),
            "description": "Servicio Agua",
        },
    )

    session.refresh(unpaired_device)

    assert response.status_code == 200
    assert response.json()["description"] == "Servicio Agua"
    assert response.json()["environmentId"] == str(seed["environment"].id)
    assert "dispenserData" not in response.json()


def test_admin_can_pair_without_amount(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    unpaired_device = Device(
        serial="IOT-DDDD-0006",
        name="Admin Pair Device",
        status=DeviceStatus.NEW,
    )
    session.add(unpaired_device)
    session.commit()

    response = client.post(
        "/api/devices/pair",
        headers={"Authorization": f"Bearer {make_token(seed['admin'].id)}"},
        json={
            "serial": unpaired_device.serial,
            "environmentId": str(seed["environment"].id),
            "description": "Servicio Admin",
        },
    )

    assert response.status_code == 200
    assert response.json()["description"] == "Servicio Admin"


def test_non_owner_cannot_pair_without_amount(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    unpaired_device = Device(
        serial="IOT-DDDD-0007",
        name="Forbidden Pair Device",
        status=DeviceStatus.NEW,
    )
    session.add(unpaired_device)
    session.commit()

    response = client.post(
        "/api/devices/pair",
        headers={"Authorization": f"Bearer {make_token(seed['guest'].id)}"},
        json={
            "serial": unpaired_device.serial,
            "environmentId": str(seed["environment"].id),
            "description": "Servicio Prohibido",
        },
    )

    assert response.status_code == 403


def test_owner_updates_generic_device_description(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)

    response = client.put(
        f"/api/devices/{seed['device'].id}",
        headers={"Authorization": f"Bearer {make_token(seed['owner'].id)}"},
        json={"description": "Monitoreo actualizado"},
    )

    session.refresh(seed["device"])
    assert response.status_code == 200
    assert response.json()["description"] == "Monitoreo actualizado"






def test_owner_can_unpair_device_via_system_session(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    system_session_used = False

    @asynccontextmanager
    async def fake_system_session():
        nonlocal system_session_used
        system_session_used = True
        async with AsyncSession(async_engine, expire_on_commit=False) as async_session:
            yield async_session

    monkeypatch.setattr("app.api.device.router.system_session", fake_system_session)
    seed = seed_context_graph(session)
    token = make_token(seed["owner"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/unpair",
        headers={"Authorization": f"Bearer {token}"},
    )

    session.refresh(seed["device"])

    assert response.status_code == 200
    assert system_session_used is True
    assert response.json()["status"] == DeviceStatus.UNPAIRED.value
    assert response.json()["environmentId"] is None
    assert seed["device"].status == DeviceStatus.UNPAIRED
    assert seed["device"].environment_id is None


def test_unpair_device_cleans_up_only_device_scoped_guest_access(
    client: TestClient,
    session: Session,
    async_engine,
    monkeypatch: pytest.MonkeyPatch,
):
    @asynccontextmanager
    async def fake_system_session():
        async with AsyncSession(async_engine, expire_on_commit=False) as async_session:
            yield async_session

    monkeypatch.setattr("app.api.device.router.system_session", fake_system_session)
    seed = seed_context_graph(session)

    device_relation = ScopedGuestRelation(
        owner_user_id=seed["owner"].id,
        guest_user_id=seed["guest"].id,
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
    )
    device_invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="future-device-cleanup@example.com",
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
    )
    environment_invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="future-environment-keep@example.com",
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
    )
    session.add(device_relation)
    session.add(device_invitation)
    session.add(environment_invitation)
    session.commit()
    session.refresh(device_relation)
    session.refresh(device_invitation)
    session.refresh(environment_invitation)

    token = make_token(seed["owner"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/unpair",
        headers={"Authorization": f"Bearer {token}"},
    )

    session.refresh(seed["device"])
    session.refresh(device_relation)
    session.refresh(device_invitation)
    session.refresh(environment_invitation)
    environment_relation = session.exec(
        select(ScopedGuestRelation).where(
            ScopedGuestRelation.scope_type == ScopeType.ENVIRONMENT,
            ScopedGuestRelation.scope_id == seed["environment"].id,
            ScopedGuestRelation.guest_user_id == seed["guest"].id,
        )
    ).one()

    assert response.status_code == 200
    assert seed["device"].status == DeviceStatus.UNPAIRED
    assert seed["device"].environment_id is None
    assert device_relation.is_active is False
    assert device_invitation.status == InvitationStatus.REVOKED
    assert device_invitation.is_active is False
    assert device_invitation.processed_at is not None
    assert environment_relation.is_active is True
    assert environment_invitation.status == InvitationStatus.PENDING
    assert environment_invitation.is_active is True
    assert environment_invitation.processed_at is None


def test_guest_cannot_manage_device_guest_relations(client: TestClient, session: Session):
    seed = seed_context_graph(session)
    token = make_token(seed["guest"].id)

    response = client.post(
        f"/api/devices/{seed['device'].id}/guests",
        headers={"Authorization": f"Bearer {token}"},
        json={"guestUserId": str(seed["owner"].id)},
    )

    assert response.status_code == 403


def test_owner_can_invite_device_guest_by_email_without_registered_user(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
):
    EmailServiceSpy.sent = []
    monkeypatch.setattr(
        "app.api.device.router.EmailService",
        EmailServiceSpy,
    )
    seed = seed_context_graph(session)
    seed["owner"].permissions = [DevicePermissions.READ, DevicePermissions.PAIR]
    session.add(seed["owner"])
    session.commit()
    token = make_token(seed["owner"].id)

    context_response = client.get(
        f"/api/access/devices/{seed['device'].id}/context",
        headers={"Authorization": f"Bearer {token}"},
    )
    response = client.post(
        f"/api/devices/{seed['device'].id}/guest-invitations",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": "future-device-guest@example.com",
            "accessStartsAt": "2026-05-27",
        },
    )
    updated_context_response = client.get(
        f"/api/access/devices/{seed['device'].id}/context",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert context_response.status_code == 200
    assert context_response.json()["isOwner"] is True
    assert response.status_code == 201
    assert response.json()["scopeType"] == ScopeType.DEVICE.value
    assert response.json()["email"] == "future-device-guest@example.com"
    assert response.json()["accessStartsAt"] == "2026-05-27T00:00:00"
    assert response.json()["status"] == "pending"
    assert EmailServiceSpy.sent == [
        {
            "email_to": "future-device-guest@example.com",
            "environment_name": "Guest Visible Device",
            "owner_email": "owner-device@example.com",
            "invitation_id": response.json()["id"],
        }
    ]
    assert updated_context_response.status_code == 200
    assert updated_context_response.json()["pendingInvitations"] == [response.json()]


def test_owner_can_revoke_pending_device_guest_invitation(client: TestClient, session: Session):
    seed = seed_context_graph(session)
    seed["owner"].permissions = [DevicePermissions.READ, DevicePermissions.PAIR]
    session.add(seed["owner"])
    session.commit()

    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="future-device-guest@example.com",
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    token = make_token(seed["owner"].id)

    response = client.delete(
        f"/api/devices/{seed['device'].id}/guest-invitations/{invitation.id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    session.refresh(invitation)

    assert response.status_code == 200
    assert response.json()["id"] == str(invitation.id)
    assert response.json()["status"] == InvitationStatus.REVOKED.value
    assert response.json()["isActive"] is False
    assert invitation.status == InvitationStatus.REVOKED
    assert invitation.is_active is False
    assert invitation.processed_at is not None


def test_guest_cannot_revoke_pending_device_guest_invitation(client: TestClient, session: Session):
    seed = seed_context_graph(session)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="future-device-guest@example.com",
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    token = make_token(seed["guest"].id)

    response = client.delete(
        f"/api/devices/{seed['device'].id}/guest-invitations/{invitation.id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    session.refresh(invitation)
    assert invitation.status == InvitationStatus.PENDING
    assert invitation.is_active is True


def test_owner_gets_404_when_revoking_missing_device_guest_invitation(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    seed["owner"].permissions = [DevicePermissions.READ, DevicePermissions.PAIR]
    session.add(seed["owner"])
    session.commit()
    token = make_token(seed["owner"].id)

    response = client.delete(
        f"/api/devices/{seed['device'].id}/guest-invitations/{uuid.uuid4()}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 404


def test_owner_gets_404_when_revoking_non_device_scoped_invitation_through_device_route(
    client: TestClient,
    session: Session,
):
    seed = seed_context_graph(session)
    seed["owner"].permissions = [DevicePermissions.READ, DevicePermissions.PAIR]
    session.add(seed["owner"])
    session.commit()

    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="future-env-guest@example.com",
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    token = make_token(seed["owner"].id)

    response = client.delete(
        f"/api/devices/{seed['device'].id}/guest-invitations/{invitation.id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 404
