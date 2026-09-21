import uuid
from datetime import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.access.models import (
    InvitationStatus,
    ScopeType,
    ScopedGuestInvitation,
    ScopedGuestRelation,
)
from app.api.access.repository import GuestAccessRepository
from app.api.access.schemas import (
    DeviceAccessContextRead,
    ScopedGuestInvitationCreate,
    ScopedGuestInvitationRead,
    ScopedGuestInvitationUpdate,
    ScopedGuestRelationCreate,
    ScopedGuestRelationRead,
    ScopedGuestRelationUpdate,
)
from app.api.access.service import GuestAccessService
from app.api.auth.repository import UserRepository
from app.api.environment.environment.repository import EnvironmentRepository
from app.api.environment.invitation.repository import EnvironmentInvitationRepository
from app.api.environment.invitation.service import EnvironmentInvitationService
from tests.api.access.test_router import make_token, seed_router_graph
from tests.api.access.test_service import seed_service_graph


def scope_id_for(seed, scope_type: ScopeType):
    return seed["environment"].id if scope_type == ScopeType.ENVIRONMENT else seed["device"].id


def relation_collection_path(seed, scope_type: ScopeType) -> str:
    scope_id = scope_id_for(seed, scope_type)
    if scope_type == ScopeType.DEVICE:
        return f"/api/devices/{scope_id}/guests"
    return f"/api/access/scopes/{scope_type.value}/{scope_id}/guests"


def relation_item_path(seed, scope_type: ScopeType, guest_id) -> str:
    return f"{relation_collection_path(seed, scope_type)}/{guest_id}"


def invitation_collection_path(seed, scope_type: ScopeType) -> str:
    scope_id = scope_id_for(seed, scope_type)
    if scope_type == ScopeType.DEVICE:
        return f"/api/devices/{scope_id}/guest-invitations"
    return f"/api/access/scopes/{scope_type.value}/{scope_id}/guest-invitations"


def invitation_item_path(seed, scope_type: ScopeType, invitation_id) -> str:
    return f"{invitation_collection_path(seed, scope_type)}/{invitation_id}"


def configure_nonzero_guest_rate(session: Session, seed, scope_type: ScopeType) -> None:
    scope = seed["environment"] if scope_type == ScopeType.ENVIRONMENT else seed["device"]
    scope.guest_commission_rate = Decimal("0.4321")
    session.add(scope)
    session.commit()


@pytest.mark.parametrize(
    "schema,payload",
    [
        (ScopedGuestRelationCreate, {"guestUserId": str(uuid.uuid4()), "commissionRate": "0.9"}),
        (ScopedGuestRelationUpdate, {"commission_rate": "0.9"}),
        (ScopedGuestInvitationCreate, {"email": "guest@example.com", "commissionRate": "0.9"}),
        (ScopedGuestInvitationUpdate, {"commission_rate": "0.9"}),
    ],
)
def test_write_schemas_ignore_obsolete_commission_fields(schema, payload):
    parsed = schema.model_validate(payload)

    assert "commission_rate" not in type(parsed).model_fields
    assert "commissionRate" not in parsed.model_dump(by_alias=True)


@pytest.mark.parametrize(
    "schema",
    [ScopedGuestRelationRead, ScopedGuestInvitationRead, DeviceAccessContextRead],
)
def test_public_read_schemas_do_not_declare_financial_fields(schema):
    field_names = set(schema.model_fields)

    assert "commission_rate" not in field_names
    assert "effective_dvem_rate" not in field_names
    assert "effective_guest_rate" not in field_names


@pytest.mark.parametrize("scope_type", [ScopeType.ENVIRONMENT, ScopeType.DEVICE])
def test_relation_create_is_access_only_and_uses_inert_zero_storage(
    client: TestClient,
    session: Session,
    scope_type: ScopeType,
):
    seed = seed_router_graph(session)
    configure_nonzero_guest_rate(session, seed, scope_type)

    response = client.post(
        relation_collection_path(seed, scope_type),
        headers={"Authorization": f"Bearer {make_token(seed['owner'].id)}"},
        json={"guestUserId": str(seed["guest"].id), "commissionRate": "0.9876"},
    )

    assert response.status_code == 201
    assert "commissionRate" not in response.json()
    relation = session.exec(
        select(ScopedGuestRelation).where(
            ScopedGuestRelation.scope_type == scope_type,
            ScopedGuestRelation.scope_id == scope_id_for(seed, scope_type),
            ScopedGuestRelation.guest_user_id == seed["guest"].id,
        )
    ).one()
    assert relation.commission_rate == Decimal("0")


@pytest.mark.parametrize("scope_type", [ScopeType.ENVIRONMENT, ScopeType.DEVICE])
def test_invitation_create_is_access_only_and_uses_inert_zero_storage(
    client: TestClient,
    session: Session,
    scope_type: ScopeType,
):
    seed = seed_router_graph(session)
    configure_nonzero_guest_rate(session, seed, scope_type)

    response = client.post(
        invitation_collection_path(seed, scope_type),
        headers={"Authorization": f"Bearer {make_token(seed['owner'].id)}"},
        json={
            "email": f"new-{scope_type.value}@example.com",
            "commission_rate": "0.9876",
        },
    )

    assert response.status_code == 201
    assert "commissionRate" not in response.json()
    invitation = session.get(ScopedGuestInvitation, uuid.UUID(response.json()["id"]))
    assert invitation is not None
    assert invitation.commission_rate == Decimal("0")


@pytest.mark.parametrize("scope_type", [ScopeType.ENVIRONMENT, ScopeType.DEVICE])
def test_date_only_updates_preserve_historical_financial_metadata(
    client: TestClient,
    session: Session,
    scope_type: ScopeType,
):
    seed = seed_router_graph(session)
    original_date = datetime(2024, 2, 3, 4, 5, 6)
    updated_date = datetime(2026, 7, 8, 9, 10, 11)
    relation = ScopedGuestRelation(
        owner_user_id=seed["owner"].id,
        guest_user_id=seed["guest"].id,
        scope_type=scope_type,
        scope_id=scope_id_for(seed, scope_type),
        commission_rate=Decimal("0.1234"),
        access_starts_at=original_date,
    )
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email=f"historical-{scope_type.value}@example.com",
        scope_type=scope_type,
        scope_id=scope_id_for(seed, scope_type),
        commission_rate=Decimal("0.5678"),
        access_starts_at=original_date,
    )
    session.add(relation)
    session.add(invitation)
    session.commit()
    session.refresh(invitation)
    headers = {"Authorization": f"Bearer {make_token(seed['owner'].id)}"}

    relation_response = client.patch(
        relation_item_path(seed, scope_type, seed["guest"].id),
        headers=headers,
        json={"accessStartsAt": updated_date.isoformat(), "commissionRate": "0.9999"},
    )
    invitation_response = client.patch(
        invitation_item_path(seed, scope_type, invitation.id),
        headers=headers,
        json={"accessStartsAt": updated_date.isoformat(), "commissionRate": "0.9999"},
    )

    assert relation_response.status_code == 200
    assert invitation_response.status_code == 200
    assert "commissionRate" not in relation_response.json()
    assert "commissionRate" not in invitation_response.json()
    session.refresh(relation)
    session.refresh(invitation)
    assert relation.commission_rate == Decimal("0.1234")
    assert invitation.commission_rate == Decimal("0.5678")
    assert relation.access_starts_at == updated_date
    assert invitation.access_starts_at == updated_date


@pytest.mark.parametrize("scope_type", [ScopeType.ENVIRONMENT, ScopeType.DEVICE])
def test_omitted_date_updates_preserve_dates_and_historical_metadata(
    client: TestClient,
    session: Session,
    scope_type: ScopeType,
):
    seed = seed_router_graph(session)
    original_date = datetime(2024, 2, 3, 4, 5, 6)
    relation = ScopedGuestRelation(
        owner_user_id=seed["owner"].id,
        guest_user_id=seed["guest"].id,
        scope_type=scope_type,
        scope_id=scope_id_for(seed, scope_type),
        commission_rate=Decimal("0.1234"),
        access_starts_at=original_date,
    )
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email=f"preserve-{scope_type.value}@example.com",
        scope_type=scope_type,
        scope_id=scope_id_for(seed, scope_type),
        commission_rate=Decimal("0.5678"),
        access_starts_at=original_date,
    )
    session.add(relation)
    session.add(invitation)
    session.commit()
    session.refresh(invitation)
    headers = {"Authorization": f"Bearer {make_token(seed['owner'].id)}"}

    relation_response = client.patch(
        relation_item_path(seed, scope_type, seed["guest"].id),
        headers=headers,
        json={"commissionRate": "0.9999"},
    )
    invitation_response = client.patch(
        invitation_item_path(seed, scope_type, invitation.id),
        headers=headers,
        json={"commissionRate": "0.9999"},
    )

    assert relation_response.status_code == 200
    assert invitation_response.status_code == 200
    session.refresh(relation)
    session.refresh(invitation)
    assert relation.access_starts_at == original_date
    assert invitation.access_starts_at == original_date
    assert relation.commission_rate == Decimal("0.1234")
    assert invitation.commission_rate == Decimal("0.5678")


@pytest.mark.parametrize("scope_type", [ScopeType.ENVIRONMENT, ScopeType.DEVICE])
def test_acceptance_ignores_historical_invitation_rate_and_preserves_access_date(
    client: TestClient,
    session: Session,
    scope_type: ScopeType,
):
    seed = seed_router_graph(session)
    selected_date = datetime(2025, 7, 8, 9, 10, 11)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email=seed["guest"].email,
        scope_type=scope_type,
        scope_id=scope_id_for(seed, scope_type),
        commission_rate=Decimal("0.8765"),
        access_starts_at=selected_date,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    response = client.post(
        f"/api/access/invitations/{invitation.id}/accept",
        headers={"Authorization": f"Bearer {make_token(seed['guest'].id)}"},
    )

    assert response.status_code == 200
    relation = session.exec(
        select(ScopedGuestRelation).where(
            ScopedGuestRelation.scope_type == scope_type,
            ScopedGuestRelation.scope_id == scope_id_for(seed, scope_type),
            ScopedGuestRelation.guest_user_id == seed["guest"].id,
        )
    ).one()
    session.refresh(invitation)
    assert invitation.status == InvitationStatus.ACCEPTED
    assert invitation.commission_rate == Decimal("0.8765")
    assert relation.commission_rate == Decimal("0")
    assert relation.access_starts_at == selected_date


@pytest.mark.asyncio
@pytest.mark.parametrize("scope_type", [ScopeType.ENVIRONMENT, ScopeType.DEVICE])
async def test_public_device_access_never_uses_financial_configuration(
    session: Session,
    async_session,
    monkeypatch: pytest.MonkeyPatch,
    scope_type: ScopeType,
):
    seed = seed_service_graph(session)
    scope_id = scope_id_for(seed, scope_type)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=scope_type,
            scope_id=scope_id,
            commission_rate=Decimal("0.7654"),
        )
    )
    session.commit()
    repository = GuestAccessRepository(async_session)

    assert not hasattr(repository, "get_commission_config")
    service = GuestAccessService(repository)
    assert not hasattr(service, "resolve_device_effective_context")

    context = await service.resolve_device_access(seed["device"].id, seed["guest"])
    payload = context.model_dump(by_alias=True)

    assert context.is_guest is True
    assert len(context.guests) == 1
    assert context.guests[0].source_scope == scope_type
    assert "effectiveDvemRate" not in payload
    assert "effectiveGuestRate" not in payload
    assert "commissionRate" not in payload["guests"][0]


@pytest.mark.asyncio
async def test_access_start_uses_earliest_applicable_relation(session: Session, async_session):
    seed = seed_service_graph(session)
    environment_start = datetime(2025, 7, 8, 9, 10, 11)
    device_start = datetime(2025, 8, 9, 10, 11, 12)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1111"),
            access_starts_at=environment_start,
        )
    )
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            commission_rate=Decimal("0.9999"),
            access_starts_at=device_start,
        )
    )
    session.commit()
    service = GuestAccessService(GuestAccessRepository(async_session))

    access_start = await service.resolve_device_guest_access_start(
        seed["device"].id,
        seed["guest"],
    )

    assert access_start == environment_start


@pytest.mark.asyncio
async def test_scoped_wrong_email_acceptance_preserves_pending_invitation_and_creates_no_relation(
    session: Session,
    async_session,
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session), email_service=None)
    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email=seed["guest"].email,
        actor_user=seed["owner"],
    )
    assert invitation.id is not None

    with pytest.raises(HTTPException) as exc:
        await service.accept_guest_invitation(
            invitation.id,
            seed["stranger"].id,
            seed["stranger"].email,
        )

    assert exc.value.status_code == 403
    persisted = await service.repository.get_guest_invitation_by_id(invitation.id)
    assert persisted is not None
    assert persisted.status == InvitationStatus.PENDING
    assert persisted.is_active is True
    assert await service.repository.list_guest_relations(ScopeType.DEVICE, seed["device"].id) == []


@pytest.mark.asyncio
async def test_legacy_wrong_email_acceptance_preserves_pending_invitation_and_creates_no_relation(
    session: Session,
    async_session,
):
    seed = seed_service_graph(session)
    service = EnvironmentInvitationService(
        EnvironmentInvitationRepository(async_session),
        EnvironmentRepository(async_session),
        UserRepository(async_session),
    )
    invitation = await service.send_invitation(
        seed["environment"].id,
        seed["guest"].email,
        seed["owner"].id,
    )
    assert invitation.id is not None

    with pytest.raises(HTTPException) as exc:
        await service.accept_invitation(
            invitation.id,
            seed["stranger"].id,
            seed["stranger"].email,
        )

    assert exc.value.status_code == 403
    persisted = await service.repo.get_by_id(invitation.id)
    assert persisted is not None
    assert persisted.status == "Pendiente"
    assert persisted.is_active is True
    assert await GuestAccessRepository(async_session).list_guest_relations(
        ScopeType.ENVIRONMENT,
        seed["environment"].id,
    ) == []
