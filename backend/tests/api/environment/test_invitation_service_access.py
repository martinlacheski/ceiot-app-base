from decimal import Decimal

import pytest
from sqlmodel import select

from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.auth.models import User
from app.api.environment.environment.models import EnvironmentUser
from app.api.environment.invitation.models import EnvironmentInvitation
from app.api.environment.invitation.service import EnvironmentInvitationService
from app.api.environment.invitation.repository import EnvironmentInvitationRepository
from app.api.environment.environment.repository import EnvironmentRepository
from app.api.auth.repository import UserRepository
from tests.api.access.test_service import seed_service_graph


class EmailServiceSpy:
    def __init__(self):
        self.calls = []

    async def send_invitation_email(
        self,
        email_to: str,
        environment_name: str,
        owner_email: str,
        invitation_id: str,
    ):
        self.calls.append(
            {
                "email_to": email_to,
                "environment_name": environment_name,
                "owner_email": owner_email,
                "invitation_id": invitation_id,
            }
        )


@pytest.mark.asyncio
async def test_accept_invitation_creates_scoped_guest_relation_and_not_environment_membership(
    session,
    async_session,
):
    seed = seed_service_graph(session)
    service = EnvironmentInvitationService(
        EnvironmentInvitationRepository(async_session),
        EnvironmentRepository(async_session),
        UserRepository(async_session),
        None,
        None,
    )

    invitation = await service.send_invitation(
        seed["environment"].id,
        seed["guest"].email,
        seed["owner"].id,
    )

    result = await service.accept_invitation(
        invitation.id,
        seed["guest"].id,
        seed["guest"].email,
    )

    relation = (
        await async_session.exec(
            select(ScopedGuestRelation).where(
                ScopedGuestRelation.scope_type == ScopeType.ENVIRONMENT,
                ScopedGuestRelation.scope_id == seed["environment"].id,
                ScopedGuestRelation.guest_user_id == seed["guest"].id,
                ScopedGuestRelation.is_active == True,
            )
        )
    ).first()
    membership = (
        await async_session.exec(
            select(EnvironmentUser).where(
                EnvironmentUser.environment_id == seed["environment"].id,
                EnvironmentUser.user_id == seed["guest"].id,
                EnvironmentUser.is_active == True,
            )
        )
    ).first()

    assert result["message"] == "Invitación aceptada correctamente"
    assert relation is not None
    assert relation.commission_rate == Decimal("0")
    assert membership is None


@pytest.mark.asyncio
async def test_list_invitations_requires_environment_owner(session, async_session):
    seed = seed_service_graph(session)
    service = EnvironmentInvitationService(
        EnvironmentInvitationRepository(async_session),
        EnvironmentRepository(async_session),
        UserRepository(async_session),
        None,
        None,
    )

    await service.send_invitation(
        seed["environment"].id,
        seed["guest"].email,
        seed["owner"].id,
    )

    with pytest.raises(Exception) as exc:
        await service.list_invitations(
            seed["environment"].id,
            actor_user_id=seed["guest"].id,
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_send_invitation_rejects_active_legacy_environment_member(
    session, async_session
):
    seed = seed_service_graph(session)
    session.add(
        EnvironmentUser(
            environment_id=seed["environment"].id,
            user_id=seed["guest"].id,
            is_owner=False,
            is_active=True,
        )
    )
    session.commit()

    service = EnvironmentInvitationService(
        EnvironmentInvitationRepository(async_session),
        EnvironmentRepository(async_session),
        UserRepository(async_session),
        None,
        None,
    )

    with pytest.raises(Exception) as exc:
        await service.send_invitation(
            seed["environment"].id,
            seed["guest"].email,
            seed["owner"].id,
        )

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_send_invitation_allows_pending_invitation_for_unregistered_email(
    session, async_session
):
    seed = seed_service_graph(session)
    email_service = EmailServiceSpy()
    service = EnvironmentInvitationService(
        EnvironmentInvitationRepository(async_session),
        EnvironmentRepository(async_session),
        UserRepository(async_session),
        None,
        email_service,
    )

    invitation = await service.send_invitation(
        seed["environment"].id,
        "future-guest@example.com",
        seed["owner"].id,
    )

    assert invitation.email == "future-guest@example.com"
    assert invitation.status == "Pendiente"
    assert email_service.calls == [
        {
            "email_to": "future-guest@example.com",
            "environment_name": seed["environment"].name,
            "owner_email": seed["owner"].email,
            "invitation_id": str(invitation.id),
        }
    ]


@pytest.mark.asyncio
async def test_get_invitation_details_allows_public_lookup_for_pending_invitation(
    session, async_session
):
    seed = seed_service_graph(session)
    service = EnvironmentInvitationService(
        EnvironmentInvitationRepository(async_session),
        EnvironmentRepository(async_session),
        UserRepository(async_session),
        None,
        None,
    )

    invitation = await service.send_invitation(
        seed["environment"].id,
        "future-guest@example.com",
        seed["owner"].id,
    )

    details = await service.get_invitation_details(invitation.id, None)

    assert details["id"] == invitation.id
    assert details["email"] == "future-guest@example.com"
    assert details["status"] == "Pendiente"
    assert details["environment_name"] == seed["environment"].name


@pytest.mark.asyncio
async def test_revoke_invitation_requires_environment_owner(session, async_session):
    seed = seed_service_graph(session)
    service = EnvironmentInvitationService(
        EnvironmentInvitationRepository(async_session),
        EnvironmentRepository(async_session),
        UserRepository(async_session),
        None,
        None,
    )

    invitation = await service.send_invitation(
        seed["environment"].id,
        seed["guest"].email,
        seed["owner"].id,
    )

    with pytest.raises(Exception) as exc:
        await service.revoke_invitation(
            invitation.id,
            actor_user_id=seed["guest"].id,
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_revoke_invitation_does_not_remove_active_legacy_environment_membership(
    session, async_session
):
    seed = seed_service_graph(session)
    session.add(
        EnvironmentUser(
            environment_id=seed["environment"].id,
            user_id=seed["guest"].id,
            is_owner=False,
            is_active=True,
        )
    )
    legacy_invitation = EnvironmentInvitation(
        email=seed["guest"].email,
        environment_id=seed["environment"].id,
        owner_id=seed["owner"].id,
        status="Aceptada",
    )
    session.add(legacy_invitation)
    session.commit()
    session.refresh(legacy_invitation)

    service = EnvironmentInvitationService(
        EnvironmentInvitationRepository(async_session),
        EnvironmentRepository(async_session),
        UserRepository(async_session),
        None,
        None,
    )

    result = await service.revoke_invitation(
        legacy_invitation.id,
        actor_user_id=seed["owner"].id,
    )

    membership = (
        await async_session.exec(
            select(EnvironmentUser).where(
                EnvironmentUser.environment_id == seed["environment"].id,
                EnvironmentUser.user_id == seed["guest"].id,
            )
        )
    ).one()

    assert result["message"] == "Invitación revocada correctamente"
    assert membership.is_active is True
