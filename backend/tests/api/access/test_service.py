import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.api.access.models import (
    InvitationStatus,
    ScopeType,
    ScopedGuestInvitation,
    ScopedGuestRelation,
)
from app.api.access.repository import GuestAccessRepository
from app.api.access.service import GuestAccessService
from app.api.auth.models import User
from app.api.device.models import Device, DeviceStatus
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.core.time import utc_now, utc_start_of_day


def seed_service_graph(session):
    country = LocationCountry(name="AR Service")
    session.add(country)
    session.commit()
    session.refresh(country)

    state = LocationState(name="CBA", country_id=country.id)
    session.add(state)
    session.commit()
    session.refresh(state)

    city = LocationCity(name="Córdoba", postal_code="5000", state_id=state.id)
    session.add(city)
    session.commit()
    session.refresh(city)

    env_type = EnvironmentType(name="Kiosk")
    session.add(env_type)
    session.commit()
    session.refresh(env_type)

    owner = User(email="owner-service@example.com", username="owner_service", password="x")
    guest = User(email="guest-service@example.com", username="guest_service", password="x")
    stranger = User(email="stranger-service@example.com", username="stranger_service", password="x")
    admin = User(
        email="admin-service@example.com",
        username="admin_service",
        password="x",
        is_admin=True,
    )
    session.add(owner)
    session.add(guest)
    session.add(stranger)
    session.add(admin)
    session.commit()
    session.refresh(owner)
    session.refresh(guest)
    session.refresh(stranger)
    session.refresh(admin)

    environment = Environment(
        name="Service Env",
        address="Street 456",
        location="Lobby",
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
        serial="IOT-BBBB-0002",
        name="Service Device",
        status=DeviceStatus.PAIRED,
        environment_id=environment.id,
    )
    session.add(device)
    session.commit()
    session.refresh(device)

    return {
        "owner": owner,
        "guest": guest,
        "stranger": stranger,
        "admin": admin,
        "environment": environment,
        "device": device,
    }


def seed_secondary_environment(session, owner: User):
    country = LocationCountry(name="AR Service Secondary")
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

    env_type = EnvironmentType(name="Bar")
    session.add(env_type)
    session.commit()
    session.refresh(env_type)

    environment = Environment(
        name="Other Service Env",
        address="Street 789",
        location="Backyard",
        description="Other env",
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
        serial="IOT-CCCC-0009",
        name="Other Service Device",
        status=DeviceStatus.PAIRED,
        environment_id=environment.id,
    )
    session.add(device)
    session.commit()
    session.refresh(device)

    return {"environment": environment, "device": device}


@pytest.mark.asyncio
async def test_service_rejects_guest_relation_creation_for_non_owner(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    with pytest.raises(HTTPException) as exc:
        await service.create_guest_relation(
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            guest_user_id=seed["guest"].id,
            actor_user=seed["stranger"],
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_service_resolves_effective_guest_access_as_read_only(
    session, async_session
):
    seed = seed_service_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
        )
    )
    session.commit()

    service = GuestAccessService(GuestAccessRepository(async_session))
    context = await service.resolve_device_access(seed["device"].id, seed["guest"])

    assert context.is_guest is True
    assert context.is_owner is False
    assert context.can_read_movements is True
    assert context.can_manage_guests is False
    assert context.can_operate_device is False
    assert "effectiveDvemRate" not in context.model_dump(by_alias=True)
    assert "effectiveGuestRate" not in context.model_dump(by_alias=True)
    assert len(context.guests) == 1
    assert context.guests[0].source_scope == ScopeType.ENVIRONMENT


@pytest.mark.asyncio
async def test_service_resolves_device_access_with_inherited_environment_pending_invitations(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    device_invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email="future-device-guest@example.com",
        actor_user=seed["owner"],
    )
    environment_invitation = await service.create_guest_invitation(
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        email="future-env-guest@example.com",
        actor_user=seed["owner"],
    )

    context = await service.resolve_device_access(seed["device"].id, seed["owner"])

    assert [invitation.id for invitation in context.pending_invitations] == [
        device_invitation.id,
        environment_invitation.id,
    ]
    inherited_invitation = context.pending_invitations[1]
    assert inherited_invitation.scope_type == ScopeType.ENVIRONMENT
    assert inherited_invitation.scope_id == seed["environment"].id



@pytest.mark.asyncio
async def test_service_denies_unrelated_user_without_contextual_access(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    with pytest.raises(HTTPException) as exc:
        await service.resolve_device_access(seed["device"].id, seed["stranger"])

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_service_accepts_device_email_invitation_after_user_registration(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email="future-device-guest@example.com",
        actor_user=seed["owner"],
    )

    future_guest = User(
        email="future-device-guest@example.com",
        username="future_device_guest",
        password="x",
    )
    session.add(future_guest)
    session.commit()
    session.refresh(future_guest)

    result = await service.accept_guest_invitation(
        invitation.id,
        future_guest.id,
        future_guest.email,
    )

    relation = await service.repository.get_guest_relation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        guest_user_id=future_guest.id,
    )
    persisted_invitation = await service.repository.get_guest_invitation_by_id(invitation.id)

    assert result["message"] == "Invitación aceptada correctamente"
    assert relation is not None
    assert persisted_invitation is not None
    assert persisted_invitation.status == InvitationStatus.ACCEPTED


@pytest.mark.asyncio
async def test_service_defaults_invitation_access_start_to_now(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))
    before_create = utc_now() - timedelta(seconds=1)

    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        email="future-env-guest@example.com",
        access_starts_at=None,
        actor_user=seed["owner"],
    )

    assert invitation.access_starts_at >= before_create
    assert invitation.access_starts_at <= utc_now()


@pytest.mark.asyncio
async def test_service_preserves_selected_invitation_access_start(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email="future-device-guest@example.com",
        access_starts_at=utc_now().date(),
        actor_user=seed["owner"],
    )

    assert invitation.access_starts_at == utc_start_of_day(utc_now().date())


@pytest.mark.asyncio
async def test_service_accepting_invitation_copies_access_start_to_relation(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))
    selected_date = utc_now().date()

    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email="future-device-guest-copy@example.com",
        access_starts_at=selected_date,
        actor_user=seed["owner"],
    )

    future_guest = User(
        email="future-device-guest-copy@example.com",
        username="future_device_guest_copy",
        password="x",
    )
    session.add(future_guest)
    session.commit()
    session.refresh(future_guest)

    await service.accept_guest_invitation(
        invitation.id,
        future_guest.id,
        future_guest.email,
    )

    relation = await service.repository.get_guest_relation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        guest_user_id=future_guest.id,
    )

    assert relation is not None
    assert relation.access_starts_at == utc_start_of_day(selected_date)


@pytest.mark.asyncio
async def test_service_preserves_selected_invitation_datetime_and_acceptance_copy(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))
    selected_datetime = datetime(2026, 5, 27, 14, 35, 0)

    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email="future-device-guest-datetime@example.com",
        access_starts_at=selected_datetime,
        actor_user=seed["owner"],
    )

    future_guest = User(
        email="future-device-guest-datetime@example.com",
        username="future_device_guest_datetime",
        password="x",
    )
    session.add(future_guest)
    session.commit()
    session.refresh(future_guest)

    await service.accept_guest_invitation(
        invitation.id,
        future_guest.id,
        future_guest.email,
    )

    relation = await service.repository.get_guest_relation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        guest_user_id=future_guest.id,
    )

    assert invitation.access_starts_at == selected_datetime
    assert relation is not None
    assert relation.access_starts_at == selected_datetime


@pytest.mark.asyncio
async def test_service_owner_can_update_pending_guest_invitation(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))
    selected_date = utc_now().date()

    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        email="future-env-guest@example.com",
        actor_user=seed["owner"],
    )

    updated = await service.update_guest_invitation(
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        invitation_id=invitation.id,
        access_starts_at=selected_date,
        actor_user=seed["owner"],
    )

    assert updated.id == invitation.id
    assert updated.access_starts_at == utc_start_of_day(selected_date)
    assert updated.status == InvitationStatus.PENDING
    assert updated.is_active is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("invitation_status", "is_active"),
    [
        (InvitationStatus.ACCEPTED, True),
        (InvitationStatus.REVOKED, False),
        (InvitationStatus.PENDING, False),
    ],
)
async def test_service_blocks_non_editable_guest_invitation_update(
    session, async_session, invitation_status, is_active
):
    seed = seed_service_graph(session)
    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="future-device-guest@example.com",
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        commission_rate=Decimal("0.1550"),
        status=invitation_status,
        is_active=is_active,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    service = GuestAccessService(GuestAccessRepository(async_session))

    with pytest.raises(HTTPException) as exc:
        await service.update_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            invitation_id=invitation.id,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_service_returns_404_when_updating_invitation_from_wrong_scope(
    session, async_session
):
    seed = seed_service_graph(session)
    other_device = Device(
        serial="IOT-BBBB-0010",
        name="Other Device For Update",
        status=DeviceStatus.PAIRED,
        environment_id=seed["environment"].id,
    )
    session.add(other_device)
    session.commit()
    session.refresh(other_device)

    service = GuestAccessService(GuestAccessRepository(async_session))
    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=other_device.id,
        email="future-device-guest@example.com",
        actor_user=seed["owner"],
    )

    with pytest.raises(HTTPException) as exc:
        await service.update_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            invitation_id=invitation.id,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_service_rejects_pending_guest_invitation_update_for_stranger(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))
    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email="future-device-guest@example.com",
        actor_user=seed["owner"],
    )

    with pytest.raises(HTTPException) as exc:
        await service.update_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            invitation_id=invitation.id,
            actor_user=seed["stranger"],
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_service_rejects_duplicate_pending_device_email_invitation(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email="future-device-guest@example.com",
        actor_user=seed["owner"],
    )

    with pytest.raises(HTTPException) as exc:
        await service.create_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            email="future-device-guest@example.com",
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_service_blocks_device_invitation_for_registered_environment_guest(
    session, async_session
):
    seed = seed_service_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1100"),
        )
    )
    session.commit()

    service = GuestAccessService(GuestAccessRepository(async_session))

    with pytest.raises(HTTPException) as exc:
        await service.create_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            email=seed["guest"].email,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 409
    assert "establecimiento asociado" in exc.value.detail


@pytest.mark.asyncio
async def test_service_blocks_device_relation_for_environment_guest(
    session, async_session
):
    seed = seed_service_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1100"),
        )
    )
    session.commit()

    service = GuestAccessService(GuestAccessRepository(async_session))

    with pytest.raises(HTTPException) as exc:
        await service.create_guest_relation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            guest_user_id=seed["guest"].id,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 409
    assert "Gestioná este invitado desde el establecimiento" in exc.value.detail


@pytest.mark.asyncio
async def test_service_blocks_device_invitation_when_environment_invitation_is_pending(
    session, async_session
):
    seed = seed_service_graph(session)
    session.add(
        ScopedGuestInvitation(
            owner_user_id=seed["owner"].id,
            email="future-env-guest@example.com",
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1550"),
        )
    )
    session.commit()

    service = GuestAccessService(GuestAccessRepository(async_session))

    with pytest.raises(HTTPException) as exc:
        await service.create_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            email="future-env-guest@example.com",
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 409
    assert "invitación pendiente al establecimiento asociado" in exc.value.detail


@pytest.mark.asyncio
async def test_service_blocks_environment_invitation_when_device_invitation_is_pending(
    session, async_session
):
    seed = seed_service_graph(session)
    pending_invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="future-device-guest@example.com",
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        commission_rate=Decimal("0.1550"),
    )
    session.add(pending_invitation)
    session.commit()
    session.refresh(pending_invitation)

    service = GuestAccessService(GuestAccessRepository(async_session))

    with pytest.raises(HTTPException) as exc:
        await service.create_guest_invitation(
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            email="future-device-guest@example.com",
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == {
        "message": (
            "Ya existe una invitación pendiente a un dispositivo de este "
            "establecimiento (Service Device) para este email. Resolvé primero el acceso a "
            "nivel dispositivo."
        ),
        "conflictScope": "device",
        "conflictType": "pending_invitation",
        "invitationId": str(pending_invitation.id),
        "deviceId": str(seed["device"].id),
        "deviceName": seed["device"].name,
        "deviceSerial": seed["device"].serial,
    }


@pytest.mark.asyncio
async def test_service_blocks_environment_relation_when_device_relation_is_active(
    session, async_session
):
    seed = seed_service_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            commission_rate=Decimal("0.1550"),
        )
    )
    session.commit()

    service = GuestAccessService(GuestAccessRepository(async_session))

    with pytest.raises(HTTPException) as exc:
        await service.create_guest_relation(
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            guest_user_id=seed["guest"].id,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == {
        "message": (
            "El usuario ya tiene acceso activo a un dispositivo de este "
            "establecimiento (Service Device). Resolvé primero el acceso a nivel "
            "dispositivo."
        ),
        "conflictScope": "device",
        "conflictType": "active_relation",
        "deviceId": str(seed["device"].id),
        "deviceName": seed["device"].name,
        "deviceSerial": seed["device"].serial,
    }


@pytest.mark.asyncio
async def test_service_blocks_environment_invitation_when_registered_user_has_device_relation(
    session, async_session
):
    seed = seed_service_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            commission_rate=Decimal("0.1550"),
        )
    )
    session.commit()

    service = GuestAccessService(GuestAccessRepository(async_session))

    with pytest.raises(HTTPException) as exc:
        await service.create_guest_invitation(
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            email=seed["guest"].email,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == {
        "message": (
            "El usuario ya tiene acceso activo a un dispositivo de este "
            "establecimiento (Service Device). Resolvé primero el acceso a nivel "
            "dispositivo."
        ),
        "conflictScope": "device",
        "conflictType": "active_relation",
        "deviceId": str(seed["device"].id),
        "deviceName": seed["device"].name,
        "deviceSerial": seed["device"].serial,
    }


@pytest.mark.asyncio
async def test_service_blocks_environment_invitation_when_pending_device_invitation_was_accepted(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email=seed["guest"].email,
        actor_user=seed["owner"],
    )
    await service.accept_guest_invitation(
        invitation.id,
        seed["guest"].id,
        seed["guest"].email,
    )

    with pytest.raises(HTTPException) as exc:
        await service.create_guest_invitation(
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            email=seed["guest"].email,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == {
        "message": (
            "El usuario ya tiene acceso activo a un dispositivo de este "
            "establecimiento (Service Device). Resolvé primero el acceso a nivel "
            "dispositivo."
        ),
        "conflictScope": "device",
        "conflictType": "active_relation",
        "invitationId": str(invitation.id),
        "deviceId": str(seed["device"].id),
        "deviceName": seed["device"].name,
        "deviceSerial": seed["device"].serial,
    }


@pytest.mark.asyncio
async def test_service_allows_environment_invitation_when_device_invitation_is_in_another_environment(
    session, async_session
):
    seed = seed_service_graph(session)
    other_scope = seed_secondary_environment(session, seed["owner"])
    session.add(
        ScopedGuestInvitation(
            owner_user_id=seed["owner"].id,
            email="future-device-guest@example.com",
            scope_type=ScopeType.DEVICE,
            scope_id=other_scope["device"].id,
            commission_rate=Decimal("0.1550"),
        )
    )
    session.commit()

    service = GuestAccessService(GuestAccessRepository(async_session))
    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        email="future-device-guest@example.com",
        actor_user=seed["owner"],
    )

    assert invitation.scope_type == ScopeType.ENVIRONMENT
    assert invitation.scope_id == seed["environment"].id


@pytest.mark.asyncio
async def test_service_owner_can_revoke_pending_device_invitation(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email="future-device-guest@example.com",
        actor_user=seed["owner"],
    )

    revoked = await service.revoke_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        invitation_id=invitation.id,
        actor_user=seed["owner"],
    )

    assert revoked.status == InvitationStatus.REVOKED
    assert revoked.is_active is False
    assert revoked.processed_at is not None
    assert await service.repository.get_guest_invitation_by_id(invitation.id) is None


@pytest.mark.asyncio
async def test_service_owner_can_revoke_accepted_device_invitation_and_relation(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email=seed["guest"].email,
        actor_user=seed["owner"],
    )
    await service.accept_guest_invitation(
        invitation.id,
        seed["guest"].id,
        seed["guest"].email,
    )

    revoked = await service.revoke_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        invitation_id=invitation.id,
        actor_user=seed["owner"],
    )

    assert revoked.status == InvitationStatus.REVOKED
    assert revoked.is_active is False
    assert revoked.processed_at is not None
    assert await service.repository.get_guest_invitation_by_id(invitation.id) is None
    assert (
        await service.repository.get_guest_relation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            guest_user_id=seed["guest"].id,
        )
        is None
    )


@pytest.mark.asyncio
async def test_service_admin_can_deactivate_device_guest_relation(
    session, async_session
):
    seed = seed_service_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest"].id,
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            commission_rate=Decimal("0.1550"),
        )
    )
    session.commit()

    service = GuestAccessService(GuestAccessRepository(async_session))

    relation = await service.deactivate_guest_relation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        guest_user_id=seed["guest"].id,
        actor_user=seed["admin"],
    )

    assert relation is not None
    assert relation.is_active is False


@pytest.mark.asyncio
async def test_service_rejects_pending_device_invitation_revoke_for_stranger(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        email="future-device-guest@example.com",
        actor_user=seed["owner"],
    )

    with pytest.raises(HTTPException) as exc:
        await service.revoke_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            invitation_id=invitation.id,
            actor_user=seed["stranger"],
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_service_returns_404_when_revoking_invitation_from_another_device(
    session, async_session
):
    seed = seed_service_graph(session)
    other_device = Device(
        serial="IOT-BBBB-0003",
        name="Other Service Device",
        status=DeviceStatus.PAIRED,
        environment_id=seed["environment"].id,
    )
    session.add(other_device)
    session.commit()
    session.refresh(other_device)

    service = GuestAccessService(GuestAccessRepository(async_session))
    invitation = await service.create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=other_device.id,
        email="future-device-guest@example.com",
        actor_user=seed["owner"],
    )

    with pytest.raises(HTTPException) as exc:
        await service.revoke_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            invitation_id=invitation.id,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_service_returns_404_when_revoking_missing_device_invitation(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    with pytest.raises(HTTPException) as exc:
        await service.revoke_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            invitation_id=uuid.uuid4(),
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [InvitationStatus.DECLINED, InvitationStatus.REVOKED])
async def test_service_returns_404_when_revoking_non_pending_device_invitation(
    session, async_session, status
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="future-device-guest@example.com",
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        commission_rate=Decimal("0.1550"),
        status=status,
        is_active=status != InvitationStatus.REVOKED,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    with pytest.raises(HTTPException) as exc:
        await service.revoke_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            invitation_id=invitation.id,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_service_returns_404_when_revoking_inactive_pending_device_invitation(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="future-device-guest@example.com",
        scope_type=ScopeType.DEVICE,
        scope_id=seed["device"].id,
        commission_rate=Decimal("0.1550"),
        status=InvitationStatus.PENDING,
        is_active=False,
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    with pytest.raises(HTTPException) as exc:
        await service.revoke_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            invitation_id=invitation.id,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_service_returns_404_when_revoking_non_device_scoped_invitation_through_device_scope(
    session, async_session
):
    seed = seed_service_graph(session)
    service = GuestAccessService(GuestAccessRepository(async_session))

    invitation = ScopedGuestInvitation(
        owner_user_id=seed["owner"].id,
        email="future-env-guest@example.com",
        scope_type=ScopeType.ENVIRONMENT,
        scope_id=seed["environment"].id,
        commission_rate=Decimal("0.1550"),
    )
    session.add(invitation)
    session.commit()
    session.refresh(invitation)

    with pytest.raises(HTTPException) as exc:
        await service.revoke_guest_invitation(
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            invitation_id=invitation.id,
            actor_user=seed["owner"],
        )

    assert exc.value.status_code == 404
