import uuid
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import and_
from sqlalchemy.orm import selectinload
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.access.models import (
    InvitationStatus,
    ScopeType,
    ScopedGuestInvitation,
    ScopedGuestRelation,
)
from app.api.auth.models import User
from app.core.db import system_session
from app.core.time import utc_now
from app.api.device.models import Device
from app.api.environment.environment.models import Environment, EnvironmentUser


@dataclass
class DeviceScopeConflictRecord:
    device_id: uuid.UUID
    device_name: str | None
    device_serial: str
    conflict_type: str
    invitation_id: uuid.UUID | None = None


class GuestAccessRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_environment(self, environment_id: uuid.UUID) -> Optional[Environment]:
        statement = (
            select(Environment)
            .where(Environment.id == environment_id)
            .options(selectinload(Environment.users))
        )
        result = await self.session.exec(statement)
        return result.first()

    async def get_device(self, device_id: uuid.UUID) -> Optional[Device]:
        statement = (
            select(Device)
            .where(Device.id == device_id)
            .options(
                selectinload(Device.environment).selectinload(Environment.users),
            )
        )
        result = await self.session.exec(statement)
        return result.first()

    async def get_environment_owner_role(
        self, environment_id: uuid.UUID
    ) -> Optional[EnvironmentUser]:
        statement = select(EnvironmentUser).where(
            EnvironmentUser.environment_id == environment_id,
            EnvironmentUser.is_owner == True,
            EnvironmentUser.is_active == True,
        )
        result = await self.session.exec(statement)
        return result.first()

    async def get_guest_relation(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        guest_user_id: uuid.UUID,
    ) -> Optional[ScopedGuestRelation]:
        statement = select(ScopedGuestRelation).where(
            ScopedGuestRelation.scope_type == scope_type,
            ScopedGuestRelation.scope_id == scope_id,
            ScopedGuestRelation.guest_user_id == guest_user_id,
            ScopedGuestRelation.is_active == True,
        )
        result = await self.session.exec(statement)
        return result.first()

    async def get_active_device_guest_relation_for_environment(
        self,
        environment_id: uuid.UUID,
        guest_user_id: uuid.UUID,
    ) -> Optional[DeviceScopeConflictRecord]:
        statement = (
            select(Device.id, Device.name, Device.serial, ScopedGuestInvitation.id)
            .select_from(ScopedGuestRelation)
            .join(Device, Device.id == ScopedGuestRelation.scope_id)
            .join(User, User.id == ScopedGuestRelation.guest_user_id)
            .outerjoin(
                ScopedGuestInvitation,
                and_(
                    ScopedGuestInvitation.scope_type == ScopeType.DEVICE,
                    ScopedGuestInvitation.scope_id == ScopedGuestRelation.scope_id,
                    ScopedGuestInvitation.email == User.email,
                    ScopedGuestInvitation.status == InvitationStatus.ACCEPTED,
                    ScopedGuestInvitation.is_active == True,
                ),
            )
            .where(
                ScopedGuestRelation.scope_type == ScopeType.DEVICE,
                ScopedGuestRelation.guest_user_id == guest_user_id,
                ScopedGuestRelation.is_active == True,
                Device.environment_id == environment_id,
            )
        )
        result = await self.session.exec(statement)
        row = result.first()
        if row is None:
            return None
        return DeviceScopeConflictRecord(
            device_id=row[0],
            device_name=row[1],
            device_serial=row[2],
            invitation_id=row[3],
            conflict_type="active_relation",
        )

    async def list_guest_relations(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
    ) -> list[ScopedGuestRelation]:
        statement = select(ScopedGuestRelation).where(
            ScopedGuestRelation.scope_type == scope_type,
            ScopedGuestRelation.scope_id == scope_id,
            ScopedGuestRelation.is_active == True,
        )
        result = await self.session.exec(statement)
        return list(result.all())

    async def create_guest_relation(
        self, relation: ScopedGuestRelation
    ) -> ScopedGuestRelation:
        self.session.add(relation)
        await self.session.commit()
        await self.session.refresh(relation)
        return relation

    async def get_user_by_email(self, email: str) -> Optional[User]:
        statement = select(User).where(User.email == email)
        result = await self.session.exec(statement)
        return result.first()

    async def get_user_by_id(self, user_id: uuid.UUID) -> Optional[User]:
        statement = select(User).where(User.id == user_id)
        result = await self.session.exec(statement)
        return result.first()

    async def get_guest_invitation(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        email: str,
    ) -> Optional[ScopedGuestInvitation]:
        statement = select(ScopedGuestInvitation).where(
            ScopedGuestInvitation.scope_type == scope_type,
            ScopedGuestInvitation.scope_id == scope_id,
            ScopedGuestInvitation.email == email,
            ScopedGuestInvitation.is_active == True,
            ScopedGuestInvitation.status == InvitationStatus.PENDING,
        )
        result = await self.session.exec(statement)
        return result.first()

    async def get_pending_device_guest_invitation_for_environment(
        self,
        environment_id: uuid.UUID,
        email: str,
    ) -> Optional[DeviceScopeConflictRecord]:
        statement = (
            select(ScopedGuestInvitation.id, Device.id, Device.name, Device.serial)
            .select_from(ScopedGuestInvitation)
            .join(Device, Device.id == ScopedGuestInvitation.scope_id)
            .where(
                ScopedGuestInvitation.scope_type == ScopeType.DEVICE,
                ScopedGuestInvitation.email == email,
                ScopedGuestInvitation.is_active == True,
                ScopedGuestInvitation.status == InvitationStatus.PENDING,
                Device.environment_id == environment_id,
            )
        )
        result = await self.session.exec(statement)
        row = result.first()
        if row is None:
            return None
        return DeviceScopeConflictRecord(
            invitation_id=row[0],
            device_id=row[1],
            device_name=row[2],
            device_serial=row[3],
            conflict_type="pending_invitation",
        )

    async def get_guest_invitation_by_id(
        self,
        invitation_id: uuid.UUID,
    ) -> Optional[ScopedGuestInvitation]:
        statement = select(ScopedGuestInvitation).where(
            ScopedGuestInvitation.id == invitation_id,
            ScopedGuestInvitation.is_active == True,
        )
        result = await self.session.exec(statement)
        return result.first()

    async def list_guest_invitations(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        pending_only: bool = True,
    ) -> list[ScopedGuestInvitation]:
        statement = select(ScopedGuestInvitation).where(
            ScopedGuestInvitation.scope_type == scope_type,
            ScopedGuestInvitation.scope_id == scope_id,
            ScopedGuestInvitation.is_active == True,
        )
        if pending_only:
            statement = statement.where(
                ScopedGuestInvitation.status == InvitationStatus.PENDING,
            )
        result = await self.session.exec(statement)
        return list(result.all())

    async def create_guest_invitation(
        self,
        invitation: ScopedGuestInvitation,
    ) -> ScopedGuestInvitation:
        self.session.add(invitation)
        await self.session.commit()
        await self.session.refresh(invitation)
        return invitation

    async def save_guest_invitation(
        self,
        invitation: ScopedGuestInvitation,
    ) -> ScopedGuestInvitation:
        self.session.add(invitation)
        await self.session.commit()
        await self.session.refresh(invitation)
        return invitation

    async def deactivate_guest_relation(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        guest_user_id: uuid.UUID,
    ) -> Optional[ScopedGuestRelation]:
        relation = await self.get_guest_relation(
            scope_type=scope_type,
            scope_id=scope_id,
            guest_user_id=guest_user_id,
        )
        if relation is None:
            return None

        relation.is_active = False
        self.session.add(relation)
        await self.session.commit()
        await self.session.refresh(relation)
        return relation

    async def cleanup_device_scope_access_on_unpair(
        self,
        device_id: uuid.UUID,
    ) -> None:
        relations = await self.list_guest_relations(
            scope_type=ScopeType.DEVICE,
            scope_id=device_id,
        )
        for relation in relations:
            relation.is_active = False
            self.session.add(relation)

        invitations = await self.list_guest_invitations(
            scope_type=ScopeType.DEVICE,
            scope_id=device_id,
        )
        processed_at = utc_now()
        for invitation in invitations:
            invitation.status = InvitationStatus.REVOKED
            invitation.is_active = False
            invitation.processed_at = processed_at
            self.session.add(invitation)

    async def update_guest_relation(
        self,
        scope_type: ScopeType,
        scope_id: uuid.UUID,
        guest_user_id: uuid.UUID,
        access_starts_at=None,
    ) -> Optional[ScopedGuestRelation]:
        relation = await self.get_guest_relation(
            scope_type=scope_type,
            scope_id=scope_id,
            guest_user_id=guest_user_id,
        )
        if relation is None:
            return None

        if access_starts_at is not None:
            relation.access_starts_at = access_starts_at
        self.session.add(relation)
        await self.session.commit()
        await self.session.refresh(relation)
        return relation

    async def get_effective_guest_access_start_for_device(
        self,
        device_id: uuid.UUID,
        environment_id: uuid.UUID,
        guest_user_id: uuid.UUID,
    ):
        device_relation = await self.get_guest_relation(
            scope_type=ScopeType.DEVICE,
            scope_id=device_id,
            guest_user_id=guest_user_id,
        )
        environment_relation = await self.get_guest_relation(
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=environment_id,
            guest_user_id=guest_user_id,
        )

        access_starts = [
            relation.access_starts_at
            for relation in (device_relation, environment_relation)
            if relation is not None
        ]
        if not access_starts:
            return None
        return min(access_starts)
