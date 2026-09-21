from decimal import Decimal
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.access.models import InvitationStatus, ScopeType, ScopedGuestInvitation, ScopedGuestRelation
from app.api.access.permissions import AccessPermissions
from app.api.auth.models import User
from app.api.device.models import Device, DeviceStatus
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.core.security import create_access_token
from app.core.time import utc_now


def make_token(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


def seed_router_graph(session: Session):
    country = LocationCountry(name="AR Router")
    session.add(country)
    session.commit()
    session.refresh(country)

    state = LocationState(name="MZA", country_id=country.id)
    session.add(state)
    session.commit()
    session.refresh(state)

    city = LocationCity(name="Mendoza", postal_code="5500", state_id=state.id)
    session.add(city)
    session.commit()
    session.refresh(city)

    env_type = EnvironmentType(name="Restaurant")
    session.add(env_type)
    session.commit()
    session.refresh(env_type)

    owner = User(
        email="owner-router@example.com",
        username="owner_router",
        password="x",
        permissions=[AccessPermissions.READ, AccessPermissions.MANAGE],
    )
    guest = User(
        email="guest-router@example.com",
        username="guest_router",
        first_name="Guest",
        last_name="Router",
        phone="5492611234567",
        password="x",
        permissions=[AccessPermissions.READ],
    )
    manager = User(
        email="manager-router@example.com",
        username="manager_router",
        password="x",
        permissions=[AccessPermissions.READ, AccessPermissions.MANAGE],
    )
    session.add(owner)
    session.add(guest)
    session.add(manager)
    session.commit()
    session.refresh(owner)
    session.refresh(guest)
    session.refresh(manager)

    environment = Environment(
        name="Router Env",
        address="Street 789",
        location="Patio",
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
        serial="IOT-CCCC-0003",
        name="Router Device",
        status=DeviceStatus.PAIRED,
        environment_id=environment.id,
    )
    session.add(device)
    session.commit()
    session.refresh(device)

    return {
        "owner": owner,
        "guest": guest,
        "manager": manager,
        "environment": environment,
        "device": device,
    }


def test_create_guest_relation_returns_403_for_non_owner(client: TestClient, session: Session):
    seed = seed_router_graph(session)
    token = make_token(seed["manager"].id)

    response = client.post(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guests",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "guestUserId": str(seed["guest"].id),
            "commissionRate": "0.1200",
        },
    )

    assert response.status_code == 403


def test_get_device_context_returns_effective_guest_access(client: TestClient, session: Session):
    seed = seed_router_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1400"),
        )
    )
    session.commit()

    token = make_token(seed["guest"].id)
    response = client.get(
        f"/api/access/devices/{seed['device'].id}/context",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["isGuest"] is True
    assert "canReadReports" not in payload
    assert payload["canReadMovements"] is True
    assert payload["canManageGuests"] is False
    assert payload["canOperateDevice"] is False
    assert len(payload["guests"]) == 1
    assert payload["guests"][0]["sourceScope"] == ScopeType.ENVIRONMENT.value
    assert payload["guests"][0]["email"] == seed["guest"].email
    assert payload["guests"][0]["firstName"] == "Guest"
    assert payload["guests"][0]["lastName"] == "Router"
    assert payload["guests"][0]["phone"] == "5492611234567"


def test_get_invitation_details_is_public_for_email_link(client: TestClient, session: Session):
    seed = seed_router_graph(session)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="new-guest@example.com",
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        commission_rate=Decimal("0.1000"),
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    response = client.get(f"/api/access/invitations/{invitation.id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(invitation.id)
    assert response.json()["email"] == "new-guest@example.com"
    assert response.json()["status"] == "pending"
    assert response.json()["scopeType"] == ScopeType.DEVICE.value
    assert response.json()["invitedUserExists"] is False


def test_get_invitation_details_reports_existing_invited_user(client: TestClient, session: Session):
    seed = seed_router_graph(session)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email=seed["guest"].email,
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        commission_rate=Decimal("0.1000"),
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    response = client.get(f"/api/access/invitations/{invitation.id}")

    assert response.status_code == 200
    assert response.json()["invitedUserExists"] is True


def test_accept_scoped_invitation_uses_public_lookup_then_email_auth(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email=seed["guest"].email,
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        commission_rate=Decimal("0.1000"),
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)
    token = make_token(seed["guest"].id)

    response = client.post(
        f"/api/access/invitations/{invitation.id}/accept",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Invitación aceptada correctamente"


def test_create_environment_scoped_invitation_preserves_selected_access_start(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    token = make_token(seed["owner"].id)

    response = client.post(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": "guest-selected@example.com",
            "commissionRate": "0.1200",
            "accessStartsAt": str(date(2026, 5, 27)),
        },
    )

    assert response.status_code == 201
    assert response.json()["accessStartsAt"] == "2026-05-27T00:00:00"


def test_create_environment_scoped_invitation_preserves_selected_access_datetime(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    token = make_token(seed["owner"].id)

    response = client.post(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": "guest-selected-datetime@example.com",
            "commissionRate": "0.1200",
            "accessStartsAt": datetime(2026, 5, 27, 14, 35, 0).isoformat(),
        },
    )

    assert response.status_code == 201
    assert response.json()["accessStartsAt"] == "2026-05-27T14:35:00"


def test_update_environment_scoped_invitation_preserves_access_start_when_omitted(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    token = make_token(seed["owner"].id)
    original_access_start = datetime(2026, 5, 27, 14, 35, 0)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="pending-update@example.com",
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        commission_rate=Decimal("0.1200"),
        access_starts_at=original_access_start,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    response = client.patch(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations/{invitation.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"commissionRate": "0.1800"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == str(invitation.id)
    assert payload["scopeType"] == ScopeType.ENVIRONMENT.value
    assert "commissionRate" not in payload
    assert payload["accessStartsAt"] == "2026-05-27T14:35:00"
    session.refresh(invitation)
    assert invitation.commission_rate == Decimal("0.1200")


def test_update_environment_scoped_invitation_allows_explicit_null_to_reset_access_start(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    token = make_token(seed["owner"].id)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="pending-reset@example.com",
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        commission_rate=Decimal("0.1200"),
        access_starts_at=datetime(2026, 5, 27, 14, 35, 0),
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)
    before_update = utc_now()

    response = client.patch(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations/{invitation.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"commissionRate": "0.1800", "accessStartsAt": None},
    )
    after_update = utc_now()

    assert response.status_code == 200
    reset_access_start = datetime.fromisoformat(response.json()["accessStartsAt"])
    assert (
        before_update - timedelta(seconds=1)
        <= reset_access_start
        <= after_update + timedelta(seconds=1)
    )

    session.refresh(invitation)
    assert invitation.access_starts_at == reset_access_start


def test_update_environment_scoped_invitation_ignores_obsolete_commission_field(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    token = make_token(seed["owner"].id)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="pending-invalid-commission@example.com",
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        commission_rate=Decimal("0.1200"),
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    response = client.patch(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations/{invitation.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"commissionRate": "1.5000"},
    )

    assert response.status_code == 200
    assert "commissionRate" not in response.json()
    session.refresh(invitation)
    assert invitation.commission_rate == Decimal("0.1200")


def test_update_device_scoped_invitation_uses_device_route_contract(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    token = make_token(seed["owner"].id)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="pending-device-update@example.com",
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        commission_rate=Decimal("0.1200"),
        access_starts_at=datetime(2026, 5, 27, 14, 35, 0),
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    response = client.patch(
        f"/api/devices/{seed['device'].id}/guest-invitations/{invitation.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "commissionRate": "0.1900",
            "accessStartsAt": datetime(2026, 6, 1, 9, 15, 0).isoformat(),
        },
    )

    assert response.status_code == 200
    assert response.json()["scopeType"] == ScopeType.DEVICE.value
    assert "commissionRate" not in response.json()
    assert response.json()["accessStartsAt"] == "2026-06-01T09:15:00"
    session.refresh(invitation)
    assert invitation.commission_rate == Decimal("0.1200")


def test_update_scoped_invitation_returns_404_for_wrong_scope(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    token = make_token(seed["owner"].id)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="pending-wrong-scope@example.com",
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        commission_rate=Decimal("0.1200"),
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    response = client.patch(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations/{invitation.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"commissionRate": "0.1800"},
    )

    assert response.status_code == 404


def test_update_scoped_invitation_returns_403_for_non_owner(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    token = make_token(seed["manager"].id)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="pending-non-owner@example.com",
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        commission_rate=Decimal("0.1200"),
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    response = client.patch(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations/{invitation.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"commissionRate": "0.1800"},
    )

    assert response.status_code == 403


@pytest.mark.parametrize(
    ("invitation_status", "is_active"),
    [
        (InvitationStatus.ACCEPTED, True),
        (InvitationStatus.REVOKED, False),
        (InvitationStatus.PENDING, False),
    ],
)
def test_update_scoped_invitation_returns_404_for_non_editable_invitation(
    client: TestClient, session: Session, invitation_status, is_active
):
    seed = seed_router_graph(session)
    token = make_token(seed["owner"].id)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="pending-non-editable@example.com",
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        commission_rate=Decimal("0.1200"),
        status=invitation_status,
        is_active=is_active,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    response = client.patch(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations/{invitation.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"commissionRate": "0.1800"},
    )

    assert response.status_code == 404


def test_list_environment_scoped_invitations_includes_accepted(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    owner_token = make_token(seed["owner"].id)
    guest_token = make_token(seed["guest"].id)

    create_response = client.post(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "email": seed["guest"].email,
            "commissionRate": "0.1200",
            "accessStartsAt": datetime(2026, 5, 27, 14, 35, 0).isoformat(),
        },
    )
    assert create_response.status_code == 201
    invitation_id = create_response.json()["id"]

    accept_response = client.post(
        f"/api/access/invitations/{invitation_id}/accept",
        headers={"Authorization": f"Bearer {guest_token}"},
    )
    assert accept_response.status_code == 200

    list_response = client.get(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations",
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    assert list_response.status_code == 200
    assert list_response.json()[0]["status"] == "accepted"


def test_revoke_accepted_environment_scoped_invitation_removes_guest_relation(
    client: TestClient, session: Session
):
    seed = seed_router_graph(session)
    owner_token = make_token(seed["owner"].id)
    guest_token = make_token(seed["guest"].id)

    create_response = client.post(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "email": seed["guest"].email,
            "commissionRate": "0.1200",
            "accessStartsAt": datetime(2026, 5, 27, 14, 35, 0).isoformat(),
        },
    )
    assert create_response.status_code == 201
    invitation_id = create_response.json()["id"]

    accept_response = client.post(
        f"/api/access/invitations/{invitation_id}/accept",
        headers={"Authorization": f"Bearer {guest_token}"},
    )
    assert accept_response.status_code == 200

    revoke_response = client.delete(
        f"/api/access/scopes/{ScopeType.ENVIRONMENT.value}/{seed['environment'].id}/guest-invitations/{invitation_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    assert revoke_response.status_code == 200
    assert revoke_response.json()["status"] == "revoked"

    relation = session.exec(
        select(ScopedGuestRelation).where(
            ScopedGuestRelation.scope_type == ScopeType.ENVIRONMENT,
            ScopedGuestRelation.scope_id == seed["environment"].id,
            ScopedGuestRelation.guest_user_id == seed["guest"].id,
        )
    ).first()
    assert relation is not None
    assert relation.is_active is False
