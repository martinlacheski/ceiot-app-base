import uuid

from fastapi import APIRouter, Depends, status

from app.api.access.models import ScopeType
from app.api.access.repository import GuestAccessRepository
from app.api.access.schemas import (
    DeviceAccessContextRead,
    InvitationDetailsRead,
    ScopedGuestInvitationCreate,
    ScopedGuestInvitationRead,
    ScopedGuestInvitationUpdate,
    ScopedGuestRelationCreate,
    ScopedGuestRelationRead,
    ScopedGuestRelationUpdate,
)
from app.api.access.service import GuestAccessService
from app.api.auth.models import User
from app.api.auth.repository import UserRepository
from app.api.environment.environment.repository import EnvironmentRepository
from app.api.environment.invitation.repository import EnvironmentInvitationRepository
from app.api.environment.invitation.service import EnvironmentInvitationService
from app.core.dependencies import (
    AuthedAsyncDBSession,
    SystemAsyncDBSession,
    get_current_user,
)
from app.core.email import EmailService

router = APIRouter(prefix="/access", tags=["Access"])


def get_service(db: AuthedAsyncDBSession) -> GuestAccessService:
    return GuestAccessService(GuestAccessRepository(db), EmailService())


def get_environment_invitation_service(db: AuthedAsyncDBSession) -> EnvironmentInvitationService:
    return EnvironmentInvitationService(
        EnvironmentInvitationRepository(db),
        EnvironmentRepository(db),
        UserRepository(db),
        None,
        EmailService(),
    )


def get_public_service(db: SystemAsyncDBSession) -> GuestAccessService:
    return GuestAccessService(GuestAccessRepository(db), EmailService())


def get_public_environment_invitation_service(
    db: SystemAsyncDBSession,
) -> EnvironmentInvitationService:
    return EnvironmentInvitationService(
        EnvironmentInvitationRepository(db),
        EnvironmentRepository(db),
        UserRepository(db),
        None,
        EmailService(),
    )


@router.post(
    "/scopes/{scope_type}/{scope_id}/guests",
    response_model=ScopedGuestRelationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_guest_relation(
    scope_type: ScopeType,
    scope_id: uuid.UUID,
    payload: ScopedGuestRelationCreate,
    service: GuestAccessService = Depends(get_service),
    current_user: User = Depends(get_current_user),
):
    return await service.create_guest_relation(
        scope_type=scope_type,
        scope_id=scope_id,
        guest_user_id=payload.guest_user_id,
        access_starts_at=payload.access_starts_at,
        actor_user=current_user,
    )


@router.patch(
    "/scopes/{scope_type}/{scope_id}/guests/{guest_user_id}",
    response_model=ScopedGuestRelationRead,
)
async def update_guest_relation(
    scope_type: ScopeType,
    scope_id: uuid.UUID,
    guest_user_id: uuid.UUID,
    payload: ScopedGuestRelationUpdate,
    service: GuestAccessService = Depends(get_service),
    current_user: User = Depends(get_current_user),
):
    return await service.update_guest_relation(
        scope_type=scope_type,
        scope_id=scope_id,
        guest_user_id=guest_user_id,
        access_starts_at=payload.access_starts_at,
        access_starts_at_was_provided="access_starts_at" in payload.model_fields_set,
        actor_user=current_user,
    )


@router.post(
    "/scopes/{scope_type}/{scope_id}/guest-invitations",
    response_model=ScopedGuestInvitationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_guest_invitation(
    scope_type: ScopeType,
    scope_id: uuid.UUID,
    payload: ScopedGuestInvitationCreate,
    service: GuestAccessService = Depends(get_service),
    current_user: User = Depends(get_current_user),
):
    return await service.create_guest_invitation(
        scope_type=scope_type,
        scope_id=scope_id,
        email=payload.email,
        access_starts_at=payload.access_starts_at,
        actor_user=current_user,
    )


@router.get(
    "/scopes/{scope_type}/{scope_id}/guest-invitations",
    response_model=list[ScopedGuestInvitationRead],
)
async def list_guest_invitations(
    scope_type: ScopeType,
    scope_id: uuid.UUID,
    service: GuestAccessService = Depends(get_service),
    current_user: User = Depends(get_current_user),
):
    await service.authorize_scope_manager(scope_type, scope_id, current_user)
    return await service.repository.list_guest_invitations(
        scope_type,
        scope_id,
        pending_only=False,
    )


@router.delete(
    "/scopes/{scope_type}/{scope_id}/guest-invitations/{invitation_id}",
    response_model=ScopedGuestInvitationRead,
)
async def revoke_guest_invitation(
    scope_type: ScopeType,
    scope_id: uuid.UUID,
    invitation_id: uuid.UUID,
    service: GuestAccessService = Depends(get_service),
    current_user: User = Depends(get_current_user),
):
    return await service.revoke_guest_invitation(
        scope_type=scope_type,
        scope_id=scope_id,
        invitation_id=invitation_id,
        actor_user=current_user,
    )


@router.patch(
    "/scopes/{scope_type}/{scope_id}/guest-invitations/{invitation_id}",
    response_model=ScopedGuestInvitationRead,
)
async def update_guest_invitation(
    scope_type: ScopeType,
    scope_id: uuid.UUID,
    invitation_id: uuid.UUID,
    payload: ScopedGuestInvitationUpdate,
    service: GuestAccessService = Depends(get_service),
    current_user: User = Depends(get_current_user),
):
    return await service.update_guest_invitation(
        scope_type=scope_type,
        scope_id=scope_id,
        invitation_id=invitation_id,
        access_starts_at=payload.access_starts_at,
        access_starts_at_was_provided="access_starts_at" in payload.model_fields_set,
        actor_user=current_user,
    )


@router.get("/devices/{device_id}/context", response_model=DeviceAccessContextRead)
async def get_device_access_context(
    device_id: uuid.UUID,
    service: GuestAccessService = Depends(get_service),
    current_user: User = Depends(get_current_user),
):
    return await service.resolve_device_access(device_id, current_user)


@router.get("/invitations/{invitation_id}", response_model=InvitationDetailsRead)
async def get_invitation_details(
    invitation_id: uuid.UUID,
    service: GuestAccessService = Depends(get_public_service),
    env_service: EnvironmentInvitationService = Depends(get_public_environment_invitation_service),
):
    scoped_invitation = await service.repository.get_guest_invitation_by_id(invitation_id)
    if scoped_invitation is not None:
        return await service.get_guest_invitation_details(invitation_id)

    details = await env_service.get_invitation_details(invitation_id)
    return InvitationDetailsRead(
        id=details["id"],
        email=details["email"],
        status=details["status"],
        owner_email=details["owner_email"],
        scope_type=ScopeType.ENVIRONMENT,
        scope_name=details["environment_name"],
        scope_id=details["environment_id"],
        environment_id=details["environment_id"],
        environment_name=details["environment_name"],
        is_active=details["is_active"],
        invited_user_exists=details.get("invited_user_exists", False),
    )


@router.post("/invitations/{invitation_id}/accept")
async def accept_invitation(
    invitation_id: uuid.UUID,
    service: GuestAccessService = Depends(get_public_service),
    env_service: EnvironmentInvitationService = Depends(get_public_environment_invitation_service),
    current_user: User = Depends(get_current_user),
):
    scoped_invitation = await service.repository.get_guest_invitation_by_id(invitation_id)
    if scoped_invitation is not None:
        return await service.accept_guest_invitation(
            invitation_id,
            current_user.id,
            current_user.email,
        )

    return await env_service.accept_invitation(
        invitation_id,
        current_user.id,
        current_user.email,
    )


@router.post("/invitations/{invitation_id}/decline")
async def decline_invitation(
    invitation_id: uuid.UUID,
    service: GuestAccessService = Depends(get_public_service),
    env_service: EnvironmentInvitationService = Depends(get_public_environment_invitation_service),
    current_user: User = Depends(get_current_user),
):
    scoped_invitation = await service.repository.get_guest_invitation_by_id(invitation_id)
    if scoped_invitation is not None:
        return await service.decline_guest_invitation(invitation_id, current_user.email)

    return await env_service.decline_invitation(invitation_id, current_user.email)
