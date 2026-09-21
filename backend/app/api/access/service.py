import logging
import uuid
from datetime import UTC, date, datetime

from fastapi import HTTPException, status

from app.api.access.models import (
    InvitationStatus,
    ScopeType,
    ScopedGuestInvitation,
    ScopedGuestRelation,
)
from app.api.access.repository import GuestAccessRepository
from app.api.access.schemas import (
    AccessGuestRead,
    DeviceAccessContextRead,
    InvitationDetailsRead,
)
from app.api.auth.models import User
from app.core.db import system_session
from app.core.email import EmailService
from app.core.time import utc_now, utc_start_of_day


logger = logging.getLogger(__name__)


class GuestAccessService:
    def __init__(self, repository: GuestAccessRepository, email_service: EmailService | None = None):
        self.repository = repository
        self.email_service = email_service

    async def create_guest_relation(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        guest_user_id: uuid.UUID,
        actor_user: User,
        access_starts_at: date | datetime | None = None,
    ) -> ScopedGuestRelation:
        owner_user_id = await self._authorize_scope_manager(scope_type, scope_id, actor_user)

        if guest_user_id == owner_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El propietario no puede invitarse a sí mismo",
            )

        existing = await self.repository.get_guest_relation(
            scope_type=scope_type,
            scope_id=scope_id,
            guest_user_id=guest_user_id,
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe una relación activa para este invitado en el alcance indicado",
            )

        await self._ensure_no_cross_scope_guest_conflict(
            scope_type=scope_type,
            scope_id=scope_id,
            guest_user_id=guest_user_id,
        )

        relation = ScopedGuestRelation(
            owner_user_id=owner_user_id,
            guest_user_id=guest_user_id,
            scope_type=scope_type,
            scope_id=scope_id,
            access_starts_at=self._normalize_access_starts_at(access_starts_at),
        )
        return await self.repository.create_guest_relation(relation)

    async def create_guest_invitation(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        email: str,
        actor_user: User,
        access_starts_at: date | datetime | None = None,
    ) -> ScopedGuestInvitation:
        owner_user_id = await self._authorize_scope_manager(scope_type, scope_id, actor_user)
        normalized_email = email.strip().lower()

        if normalized_email == actor_user.email.lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El propietario no puede invitarse a sí mismo",
            )

        target_user = await self.repository.get_user_by_email(normalized_email)
        if target_user is not None:
            existing_relation = await self.repository.get_guest_relation(
                scope_type=scope_type,
                scope_id=scope_id,
                guest_user_id=target_user.id,
            )
            if existing_relation is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="El usuario ya tiene acceso activo como invitado en este alcance.",
                )

        await self._ensure_no_cross_scope_guest_conflict(
            scope_type=scope_type,
            scope_id=scope_id,
            guest_user_id=target_user.id if target_user is not None else None,
            email=normalized_email,
        )

        existing_invitation = await self.repository.get_guest_invitation(
            scope_type=scope_type,
            scope_id=scope_id,
            email=normalized_email,
        )
        if existing_invitation is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe una invitación pendiente para este email en este alcance.",
            )

        invitation = ScopedGuestInvitation(
            owner_user_id=owner_user_id,
            email=normalized_email,
            scope_type=scope_type,
            scope_id=scope_id,
            access_starts_at=self._normalize_access_starts_at(access_starts_at),
        )
        created_invitation = await self.repository.create_guest_invitation(invitation)

        if self.email_service is not None:
            scope_name, _ = await self._resolve_scope_metadata(scope_type, scope_id)
            await self.email_service.send_invitation_email(
                email_to=normalized_email,
                environment_name=scope_name,
                owner_email=actor_user.email,
                invitation_id=str(created_invitation.id),
            )

        return created_invitation

    async def update_guest_relation(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        guest_user_id: uuid.UUID,
        actor_user: User,
        access_starts_at: date | datetime | None = None,
        access_starts_at_was_provided: bool = True,
    ) -> ScopedGuestRelation:
        owner_user_id = await self._authorize_scope_manager(scope_type, scope_id, actor_user)

        if guest_user_id == owner_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El propietario no puede editarse como invitado",
            )

        relation = await self.repository.update_guest_relation(
            scope_type=scope_type,
            scope_id=scope_id,
            guest_user_id=guest_user_id,
            access_starts_at=self._normalize_access_starts_at(access_starts_at)
            if access_starts_at_was_provided
            else None,
        )
        if relation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No se encontró una relación activa para este invitado en el alcance indicado",
            )
        return relation

    async def update_guest_invitation(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        invitation_id: uuid.UUID,
        actor_user: User,
        access_starts_at: date | datetime | None = None,
        access_starts_at_was_provided: bool = True,
    ) -> ScopedGuestInvitation:
        try:
            await self._authorize_scope_manager(scope_type, scope_id, actor_user)

            invitation = await self.repository.get_guest_invitation_by_id(invitation_id)
            if (
                invitation is None
                or invitation.scope_type != scope_type
                or invitation.scope_id != scope_id
                or invitation.status != InvitationStatus.PENDING
                or not invitation.is_active
            ):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No se encontró una invitación pendiente para este alcance",
                )

            if access_starts_at_was_provided:
                invitation.access_starts_at = self._normalize_access_starts_at(access_starts_at)
            return await self.repository.save_guest_invitation(invitation)
        except HTTPException as exc:
            logger.warning(
                "Pending invitation update rejected: status_code=%s scope_type=%s scope_id=%s invitation_id=%s actor_user_id=%s",
                exc.status_code,
                scope_type,
                scope_id,
                invitation_id,
                actor_user.id,
            )
            raise
        except Exception:
            logger.exception(
                "Unexpected pending invitation update failure: scope_type=%s scope_id=%s invitation_id=%s actor_user_id=%s",
                scope_type,
                scope_id,
                invitation_id,
                actor_user.id,
            )
            raise

    async def resolve_device_access(
        self,
        device_id: uuid.UUID,
        actor_user: User,
    ) -> DeviceAccessContextRead:
        device = await self.repository.get_device(device_id)
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dispositivo no encontrado",
            )
        if device.environment_id is None or device.environment is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El dispositivo no tiene un establecimiento asociado",
            )

        owner_role = await self.repository.get_environment_owner_role(device.environment_id)
        if owner_role is None:
            async with system_session() as sys_session:
                owner_role = await GuestAccessRepository(
                    sys_session,
                ).get_environment_owner_role(device.environment_id)
        if owner_role is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No se encontró un propietario activo para el establecimiento del dispositivo",
            )

        environment_relations = await self.repository.list_guest_relations(
            ScopeType.ENVIRONMENT,
            device.environment_id,
        )
        device_relations = await self.repository.list_guest_relations(
            ScopeType.DEVICE,
            device_id,
        )
        merged_guests: dict[uuid.UUID, AccessGuestRead] = {}
        for source_scope, relations in (
            (ScopeType.ENVIRONMENT, environment_relations),
            (ScopeType.DEVICE, device_relations),
        ):
            for relation in relations:
                guest_user = await self.repository.get_user_by_id(relation.guest_user_id)
                merged_guests[relation.guest_user_id] = AccessGuestRead(
                    guest_user_id=relation.guest_user_id,
                    email=guest_user.email if guest_user else None,
                    first_name=guest_user.first_name if guest_user else None,
                    last_name=guest_user.last_name if guest_user else None,
                    phone=guest_user.phone if guest_user else None,
                    access_starts_at=relation.access_starts_at,
                    source_scope=source_scope,
                )
        guests = sorted(merged_guests.values(), key=lambda guest: str(guest.guest_user_id))

        is_owner = actor_user.id == owner_role.user_id
        is_guest = actor_user.id in {guest.guest_user_id for guest in guests}
        if not (actor_user.is_admin or is_owner or is_guest):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes acceso contextual a este dispositivo",
            )

        pending_invitations = []
        if is_owner:
            device_invitations = await self.repository.list_guest_invitations(
                ScopeType.DEVICE,
                device_id,
            )
            environment_invitations = await self.repository.list_guest_invitations(
                ScopeType.ENVIRONMENT,
                device.environment_id,
            )
            pending_invitations = [*device_invitations, *environment_invitations]

        return DeviceAccessContextRead(
            device_id=device_id,
            environment_id=device.environment_id,
            owner_user_id=owner_role.user_id,
            actor_user_id=actor_user.id,
            is_owner=is_owner,
            is_guest=is_guest,
            can_read_movements=True,
            can_manage_guests=is_owner,
            can_operate_device=actor_user.is_admin or is_owner,
            guests=guests,
            pending_invitations=pending_invitations,
        )

    async def deactivate_guest_relation(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        guest_user_id: uuid.UUID,
        actor_user: User,
    ) -> ScopedGuestRelation | None:
        await self._authorize_scope_manager(scope_type, scope_id, actor_user)
        relation = await self.repository.deactivate_guest_relation(
            scope_type=scope_type,
            scope_id=scope_id,
            guest_user_id=guest_user_id,
        )
        if relation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No se encontró una relación activa para este invitado en el alcance indicado",
            )
        return relation

    async def get_guest_invitation_details(
        self,
        invitation_id: uuid.UUID,
        user_email: str | None = None,
    ) -> InvitationDetailsRead:
        invitation = await self.repository.get_guest_invitation_by_id(invitation_id)
        if invitation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invitación no encontrada",
            )

        if user_email and invitation.email.lower() != user_email.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permiso para ver esta invitación.",
            )

        scope_name, environment_id = await self._resolve_scope_metadata(
            invitation.scope_type,
            invitation.scope_id,
        )
        owner_user = await self.repository.get_user_by_id(invitation.owner_user_id)
        invited_user = await self.repository.get_user_by_email(invitation.email.lower())
        return InvitationDetailsRead(
            id=invitation.id,
            email=invitation.email,
            status=invitation.status.value,
            owner_email=owner_user.email if owner_user else "Desconocido",
            scope_type=invitation.scope_type,
            scope_name=scope_name,
            scope_id=invitation.scope_id,
            environment_id=environment_id,
            environment_name=scope_name if invitation.scope_type == ScopeType.ENVIRONMENT else "",
            is_active=invitation.is_active,
            invited_user_exists=invited_user is not None,
        )

    async def accept_guest_invitation(
        self,
        invitation_id: uuid.UUID,
        user_id: uuid.UUID,
        user_email: str,
    ) -> dict:
        invitation = await self.repository.get_guest_invitation_by_id(invitation_id)
        if invitation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invitación no encontrada o inválida",
            )

        if invitation.email.lower() != user_email.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permiso para aceptar esta invitación (el email no coincide).",
            )

        if invitation.status != InvitationStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Esta invitación ya fue procesada",
            )

        existing_relation = await self.repository.get_guest_relation(
            scope_type=invitation.scope_type,
            scope_id=invitation.scope_id,
            guest_user_id=user_id,
        )
        if existing_relation is None:
            owner_user = await self.repository.get_user_by_id(invitation.owner_user_id)
            actor_user = owner_user or User(
                id=invitation.owner_user_id,
                email="owner@local",
                username="owner_local",
                password="x",
            )
            await self.create_guest_relation(
                scope_type=invitation.scope_type,
                scope_id=invitation.scope_id,
                guest_user_id=user_id,
                access_starts_at=invitation.access_starts_at,
                actor_user=actor_user,
            )

        invitation.status = InvitationStatus.ACCEPTED
        invitation.processed_at = utc_now()
        await self.repository.save_guest_invitation(invitation)
        return {"message": "Invitación aceptada correctamente"}

    async def decline_guest_invitation(
        self,
        invitation_id: uuid.UUID,
        user_email: str,
    ) -> dict:
        invitation = await self.repository.get_guest_invitation_by_id(invitation_id)
        if invitation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invitación no encontrada",
            )

        if invitation.email.lower() != user_email.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permiso para rechazar esta invitación.",
            )

        if invitation.status != InvitationStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Esta invitación ya fue procesada",
            )

        invitation.status = InvitationStatus.DECLINED
        invitation.is_active = False
        invitation.processed_at = utc_now()
        await self.repository.save_guest_invitation(invitation)
        return {"message": "Invitación rechazada correctamente"}

    async def revoke_guest_invitation(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        invitation_id: uuid.UUID,
        actor_user: User,
    ) -> ScopedGuestInvitation:
        await self._authorize_scope_manager(scope_type, scope_id, actor_user)

        invitation = await self.repository.get_guest_invitation_by_id(invitation_id)
        if (
            invitation is None
            or invitation.scope_type != scope_type
            or invitation.scope_id != scope_id
            or invitation.status
            not in {InvitationStatus.PENDING, InvitationStatus.ACCEPTED}
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No se encontró una invitación revocable para este alcance",
            )

        if invitation.status == InvitationStatus.ACCEPTED:
            guest_user = await self.repository.get_user_by_email(invitation.email)
            if guest_user is not None:
                await self.repository.deactivate_guest_relation(
                    scope_type=scope_type,
                    scope_id=scope_id,
                    guest_user_id=guest_user.id,
                )

        invitation.status = InvitationStatus.REVOKED
        invitation.is_active = False
        invitation.processed_at = utc_now()
        return await self.repository.save_guest_invitation(invitation)

    async def require_scope_owner(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        actor_user_id: uuid.UUID,
    ) -> uuid.UUID:
        return await self._require_scope_owner(scope_type, scope_id, actor_user_id)

    async def authorize_scope_manager(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        actor_user: User,
    ) -> uuid.UUID:
        return await self._authorize_scope_manager(scope_type, scope_id, actor_user)

    async def resolve_device_guest_access_start(
        self,
        device_id: uuid.UUID,
        actor_user: User,
    ) -> datetime | None:
        context = await self.resolve_device_access(device_id, actor_user)
        if actor_user.is_admin or context.is_owner or not context.is_guest:
            return None

        return await self.repository.get_effective_guest_access_start_for_device(
            device_id=device_id,
            environment_id=context.environment_id,
            guest_user_id=actor_user.id,
        )

    async def _authorize_scope_manager(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        actor_user: User,
    ) -> uuid.UUID:
        owner_user_id = await self._resolve_scope_owner(scope_type, scope_id)
        if actor_user.is_admin:
            return owner_user_id

        if owner_user_id != actor_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo el propietario puede gestionar invitados en este alcance",
            )
        return owner_user_id

    async def _require_scope_owner(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        actor_user_id: uuid.UUID,
    ) -> uuid.UUID:
        owner_user_id = await self._resolve_scope_owner(scope_type, scope_id)
        if owner_user_id != actor_user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo el propietario puede gestionar invitados en este alcance",
            )
        return owner_user_id

    async def _resolve_scope_owner(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
    ) -> uuid.UUID:
        if scope_type == ScopeType.ENVIRONMENT:
            owner_role = await self.repository.get_environment_owner_role(scope_id)
            if owner_role is None:
                async with system_session() as sys_session:
                    owner_role = await GuestAccessRepository(
                        sys_session,
                    ).get_environment_owner_role(scope_id)
            if owner_role is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No se encontró un propietario activo para el establecimiento",
                )
            return owner_role.user_id

        device = await self.repository.get_device(scope_id)
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dispositivo no encontrado",
            )
        if device.environment_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El dispositivo no tiene un establecimiento asociado",
            )

        owner_role = await self.repository.get_environment_owner_role(device.environment_id)
        if owner_role is None:
            async with system_session() as sys_session:
                owner_role = await GuestAccessRepository(
                    sys_session,
                ).get_environment_owner_role(device.environment_id)
        if owner_role is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No se encontró un propietario activo para el establecimiento del dispositivo",
            )
        return owner_role.user_id

    async def _resolve_scope_metadata(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
    ) -> tuple[str, uuid.UUID]:
        if scope_type == ScopeType.ENVIRONMENT:
            environment = await self.repository.get_environment(scope_id)
            if environment is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Establecimiento no encontrado",
                )
            return environment.name, environment.id

        device = await self.repository.get_device(scope_id)
        if device is None or device.environment_id is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dispositivo no encontrado",
            )
        return device.name or device.serial, device.environment_id

    async def _ensure_no_cross_scope_guest_conflict(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        guest_user_id: uuid.UUID | None = None,
        email: str | None = None,
    ) -> None:
        if scope_type == ScopeType.DEVICE:
            _, environment_id = await self._resolve_scope_metadata(scope_type, scope_id)

            if guest_user_id is not None:
                environment_relation = await self.repository.get_guest_relation(
                    scope_type=ScopeType.ENVIRONMENT,
                    scope_id=environment_id,
                    guest_user_id=guest_user_id,
                )
                if environment_relation is not None:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            "El usuario ya tiene acceso activo al establecimiento asociado. "
                            "Gestioná este invitado desde el establecimiento."
                        ),
                    )

            if email is None:
                return

            environment_invitation = await self.repository.get_guest_invitation(
                scope_type=ScopeType.ENVIRONMENT,
                scope_id=environment_id,
                email=email,
            )
            if environment_invitation is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Ya existe una invitación pendiente al establecimiento asociado para "
                        "este email. Gestioná este invitado desde el establecimiento."
                    ),
                )
            return

        if scope_type != ScopeType.ENVIRONMENT:
            return

        environment_id = scope_id

        if guest_user_id is not None:
            device_relation = await self.repository.get_active_device_guest_relation_for_environment(
                environment_id=environment_id,
                guest_user_id=guest_user_id,
            )
            if device_relation is not None:
                device_label = device_relation.device_name or device_relation.device_serial
                detail = {
                    "message": (
                        "El usuario ya tiene acceso activo a un dispositivo de este "
                        f"establecimiento ({device_label}). Resolvé primero el acceso "
                        "a nivel dispositivo."
                    ),
                    "conflictScope": "device",
                    "conflictType": device_relation.conflict_type,
                    "deviceId": str(device_relation.device_id),
                    "deviceName": device_relation.device_name,
                    "deviceSerial": device_relation.device_serial,
                }
                if device_relation.invitation_id is not None:
                    detail["invitationId"] = str(device_relation.invitation_id)

                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=detail,
                )

        if email is None:
            return

        pending_device_invitation = await self.repository.get_pending_device_guest_invitation_for_environment(
            environment_id=environment_id,
            email=email,
        )
        if pending_device_invitation is not None:
            device_label = (
                pending_device_invitation.device_name or pending_device_invitation.device_serial
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": (
                        "Ya existe una invitación pendiente a un dispositivo de este "
                        f"establecimiento ({device_label}) para este email. Resolvé primero "
                        "el acceso a nivel dispositivo."
                    ),
                    "conflictScope": "device",
                    "conflictType": pending_device_invitation.conflict_type,
                    "invitationId": str(pending_device_invitation.invitation_id),
                    "deviceId": str(pending_device_invitation.device_id),
                    "deviceName": pending_device_invitation.device_name,
                    "deviceSerial": pending_device_invitation.device_serial,
                },
            )

    def _normalize_access_starts_at(
        self,
        access_starts_at: date | datetime | None,
    ) -> datetime:
        if access_starts_at is None:
            return utc_now()

        if isinstance(access_starts_at, datetime):
            if access_starts_at.tzinfo is not None:
                return access_starts_at.astimezone(UTC).replace(tzinfo=None)
            return access_starts_at

        return utc_start_of_day(access_starts_at)
