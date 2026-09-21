from fastapi import APIRouter, Depends, status, HTTPException
from typing import Optional
import uuid

from app.core.dependencies import AuthedAsyncDBSession, PermissionChecker
from app.api.auth.models import User
from app.api.auth.repository import UserRepository
from app.core.email import EmailService
from app.api.environment.invitation.service import EnvironmentInvitationService
from app.api.environment.invitation.repository import EnvironmentInvitationRepository
from app.api.environment.invitation.models import (
    EnvironmentInvitationRead, EnvironmentInvitationCreate
)
from app.api.environment.environment.repository import EnvironmentRepository

router = APIRouter()

async def get_service(db: AuthedAsyncDBSession) -> EnvironmentInvitationService:
    return EnvironmentInvitationService(
        EnvironmentInvitationRepository(db),
        EnvironmentRepository(db),
        UserRepository(db),
        None, # AuthService not used yet
        EmailService()
    )

@router.post("/{env_id}/invitations", 
             response_model=EnvironmentInvitationRead, 
             status_code=status.HTTP_201_CREATED)
async def send_invitation(
    env_id: uuid.UUID,
    payload: EnvironmentInvitationCreate, # We only need email really, but using Create DTO is fine
    service: EnvironmentInvitationService = Depends(get_service),
    current_user: User = Depends(PermissionChecker("invitation:create"))
):
    # DTO might have env_id/owner_id but we override with path param and current_user
    return await service.send_invitation(env_id, payload.email, current_user.id)

@router.get("/{env_id}/invitations", 
            response_model=dict)
async def list_invitations(
    env_id: uuid.UUID,
    page: int = 1,
    per_page: int = 10,
    service: EnvironmentInvitationService = Depends(get_service),
    current_user: User = Depends(PermissionChecker("invitation:read"))
):
    return await service.list_invitations(env_id, current_user.id, page, per_page)

@router.delete("/{env_id}/invitations/{invitation_id}")
async def revoke_invitation(
    env_id: uuid.UUID, # Included for URL structure/consistency, service verifies ownership
    invitation_id: uuid.UUID,
    service: EnvironmentInvitationService = Depends(get_service),
    current_user: User = Depends(PermissionChecker("invitation:delete"))
):
    return await service.revoke_invitation(invitation_id, current_user.id)

@router.get("/invitations/{invitation_id}")
async def get_invitation(
    invitation_id: uuid.UUID,
    service: EnvironmentInvitationService = Depends(get_service),
):
    return await service.get_invitation_details(invitation_id)

@router.post("/invitations/{invitation_id}/decline")
async def decline_invitation(
    invitation_id: uuid.UUID,
    service: EnvironmentInvitationService = Depends(get_service),
    current_user: User = Depends(PermissionChecker("invitation:read"))
):
    return await service.decline_invitation(invitation_id, current_user.email)

@router.post("/invitations/{invitation_id}/accept")
async def accept_invitation(
    invitation_id: uuid.UUID,
    service: EnvironmentInvitationService = Depends(get_service),
    current_user: User = Depends(PermissionChecker("invitation:read")) # Any logged in user
):
    return await service.accept_invitation(invitation_id, current_user.id, current_user.email)
