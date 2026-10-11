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
from app.core.dependencies import (
    AuthedAsyncDBSession,
    SystemAsyncDBSession,
    get_current_user,
)
from app.core.email import EmailService

router = APIRouter(prefix="/access", tags=["Access"])


def get_service(db: AuthedAsyncDBSession) -> GuestAccessService:
    return GuestAccessService(GuestAccessRepository(db), EmailService())


def get_public_service(db: SystemAsyncDBSession) -> GuestAccessService:
    return GuestAccessService(GuestAccessRepository(db), EmailService())


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
):
    return await service.get_guest_invitation_details(invitation_id)


@router.post("/invitations/{invitation_id}/accept")
async def accept_invitation(
    invitation_id: uuid.UUID,
    service: GuestAccessService = Depends(get_public_service),
    current_user: User = Depends(get_current_user),
):
    return await service.accept_guest_invitation(
        invitation_id,
        current_user.id,
        current_user.email,
    )


@router.post("/invitations/{invitation_id}/decline")
async def decline_invitation(
    invitation_id: uuid.UUID,
    service: GuestAccessService = Depends(get_public_service),
    current_user: User = Depends(get_current_user),
):
    return await service.decline_guest_invitation(invitation_id, current_user.email)
