from fastapi import HTTPException, status
from typing import Optional
import uuid

from app.api.access.models import ScopeType
from app.api.access.repository import GuestAccessRepository
from app.api.access.service import GuestAccessService
from app.api.environment.invitation.models import (
    EnvironmentInvitation, EnvironmentInvitationCreate, EnvironmentInvitationUpdate
)
from app.api.environment.invitation.repository import EnvironmentInvitationRepository
from app.api.environment.environment.repository import EnvironmentRepository
from app.api.environment.environment.models import EnvironmentUser
from app.api.auth.service import AuthService
from app.api.auth.models import User
from app.api.auth.repository import UserRepository
from app.core.email import EmailService
from app.core.time import utc_now

class EnvironmentInvitationService:
    def __init__(self, repo: EnvironmentInvitationRepository, env_repo: EnvironmentRepository, user_repo: UserRepository = None, auth_service: AuthService = None, email_service: EmailService = None):
        self.repo = repo
        self.env_repo = env_repo
        self.user_repo = user_repo
        self.email_service = email_service

    async def send_invitation(self, env_id: uuid.UUID, email: str, owner_id: uuid.UUID) -> EnvironmentInvitation:
        access_service = GuestAccessService(GuestAccessRepository(self.repo.db))
        await access_service.require_scope_owner(ScopeType.ENVIRONMENT, env_id, owner_id)

        normalized_email = email.strip().lower()

        # 0. Validate if User Exists when applicable
        target_user = None
        if self.user_repo:
            target_user = await self.user_repo.get_by_email(normalized_email)

        # 1. Check if already invited or already has active guest access
        if target_user:
             legacy_membership = await self.env_repo.get_user_role(env_id, target_user.id)
             if legacy_membership and legacy_membership.is_active:
                 raise HTTPException(
                     status_code=status.HTTP_409_CONFLICT,
                     detail="El usuario ya tiene acceso activo a este establecimiento.",
                 )

             existing_relation = await GuestAccessRepository(self.repo.db).get_guest_relation(
                 scope_type=ScopeType.ENVIRONMENT,
                 scope_id=env_id,
                 guest_user_id=target_user.id,
             )
             if existing_relation and existing_relation.is_active:
                 raise HTTPException(
                     status_code=status.HTTP_409_CONFLICT,
                     detail="El usuario ya tiene acceso activo como invitado a este establecimiento."
                 )

        # 2. Check if already invited (Pending)
        existing = await self.repo.get_by_environment_and_email(env_id, normalized_email)
        if existing and existing.status == "Pendiente":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, 
                detail="Ya existe una invitación pendiente para este email en este establecimiento."
            )
        
        # 3. Create Invitation
        invitation = EnvironmentInvitation(
            email=normalized_email,
            environment_id=env_id,
            owner_id=owner_id,
            status="Pendiente"
        )
        created_invitation = await self.repo.create(invitation)

        # 4. Send Email
        if self.email_service:
            # We need environment name. 
            # Ideally we fetch it or pass it. Fetching is safer.
            env = await self.env_repo.get_by_id(env_id)
            env_name = env.name if env else "IoT Environment"
            
            # Fetch Owner Email
            owner_email = "noreply@example.invalid"
            if self.user_repo:
                 owner_user = await self.user_repo.get_by_id(owner_id)
                 if owner_user:
                     owner_email = owner_user.email

            await self.email_service.send_invitation_email(
                email_to=normalized_email,
                environment_name=env_name,
                owner_email=owner_email,
                invitation_id=str(created_invitation.id)
            )

        return created_invitation

    async def list_invitations(
        self,
        env_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        page: int = 1,
        per_page: int = 10,
    ) -> dict:
        await GuestAccessService(GuestAccessRepository(self.repo.db)).require_scope_owner(
            ScopeType.ENVIRONMENT,
            env_id,
            actor_user_id,
        )
        return await self.repo.get_all_by_environment(env_id, page, per_page)

    async def get_invitation_details(self, invitation_id: uuid.UUID, user_email: Optional[str] = None) -> dict:
        invitation = await self.repo.get_by_id(invitation_id)
        if not invitation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")
        
        # Verify Email/Ownership of the invite when authenticated context is provided
        if user_email and invitation.email.lower() != user_email.lower():
             raise HTTPException(
                  status_code=status.HTTP_403_FORBIDDEN, 
                  detail="No tienes permiso para ver esta invitación."
              )
        
        env = await self.env_repo.get_by_id(invitation.environment_id)
        env_name = env.name if env else "Establecimiento Desconocido"
        
        owner_email = "Desconocido"
        if self.user_repo:
            owner_user = await self.user_repo.get_by_id(invitation.owner_id)
            if owner_user:
                owner_email = owner_user.email
        invited_user_exists = False
        if self.user_repo:
            invited_user_exists = await self.user_repo.get_by_email(invitation.email.lower()) is not None
        
        return {
            "id": invitation.id,
            "email": invitation.email,
            "status": invitation.status,
            "environment_name": env_name,
            "owner_email": owner_email,
            "environment_id": invitation.environment_id,
            "is_active": invitation.is_active,
            "invited_user_exists": invited_user_exists,
        }

    async def decline_invitation(self, invitation_id: uuid.UUID, user_email: str) -> dict:
        invitation = await self.repo.get_by_id(invitation_id)
        if not invitation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")

        if invitation.email.lower() != user_email.lower():
             raise HTTPException(
                 status_code=status.HTTP_403_FORBIDDEN, 
                 detail="No tienes permiso para rechazar esta invitación."
             )
            
        if invitation.status != "Pendiente":
             raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Esta invitación ya fue procesada")

        invitation.status = "Rechazada"
        invitation.is_active = False # Logically close it
        invitation.processed_at = utc_now()
        self.repo.db.add(invitation)
        await self.repo.db.commit()
        
        return {"message": "Invitación rechazada correctamente"}

    async def revoke_invitation(self, invitation_id: uuid.UUID, actor_user_id: uuid.UUID) -> dict:
        # 1. Get Invitation
        invitation = await self.repo.get_by_id(invitation_id)
        if not invitation:
             raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada")

        await GuestAccessService(GuestAccessRepository(self.repo.db)).require_scope_owner(
            ScopeType.ENVIRONMENT,
            invitation.environment_id,
            actor_user_id,
        )
        
        # 2. Check if User exists and remove access
        if self.user_repo:
            user = await self.user_repo.get_by_email(invitation.email)
            if user:
                await GuestAccessRepository(self.repo.db).deactivate_guest_relation(
                    scope_type=ScopeType.ENVIRONMENT,
                    scope_id=invitation.environment_id,
                    guest_user_id=user.id,
                )

        # 3. Soft Delete / Revoke Invitation
        invitation.status = "Revocada"
        invitation.is_active = False
        invitation.processed_at = utc_now()
        self.repo.db.add(invitation)
        await self.repo.db.commit()
        
        return {"message": "Invitación revocada correctamente"}

    async def accept_invitation(self, invitation_id: uuid.UUID, user_id: uuid.UUID, user_email: str) -> dict:
        # 1. Get Invitation
        invitation = await self.repo.get_by_id(invitation_id)
        if not invitation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitación no encontrada o inválida")
        
        # Verify Email
        if invitation.email.lower() != user_email.lower():
             raise HTTPException(
                 status_code=status.HTTP_403_FORBIDDEN, 
                 detail="No tienes permiso para aceptar esta invitación (el email no coincide)."
             )
        
        if invitation.status != "Pendiente":
             raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Esta invitación ya fue procesada")

        # 2. Create scoped guest relation without creating legacy membership
        owner_user = await self.user_repo.get_by_id(invitation.owner_id) if self.user_repo else None
        actor_user = owner_user or User(
            id=invitation.owner_id,
            email="owner@local",
            username="owner_local",
            password="x",
        )
        access_service = GuestAccessService(GuestAccessRepository(self.repo.db))
        await access_service.create_guest_relation(
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=invitation.environment_id,
            guest_user_id=user_id,
            actor_user=actor_user,
        )

        # 3. Update Invitation Status
        invitation.status = "Aceptada"
        invitation.processed_at = utc_now()
        self.repo.db.add(invitation)
        await self.repo.db.commit() # Commit transaction
        
        return {"message": "Invitación aceptada correctamente"}
