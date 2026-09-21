import uuid
from datetime import date, datetime

from app.api.access.models import ScopeType
from app.core.utils import CamelModel


class ScopedGuestRelationCreate(CamelModel):
    guest_user_id: uuid.UUID
    access_starts_at: date | datetime | None = None


class ScopedGuestRelationUpdate(CamelModel):
    access_starts_at: date | datetime | None = None


class ScopedGuestInvitationCreate(CamelModel):
    email: str
    access_starts_at: date | datetime | None = None


class ScopedGuestInvitationUpdate(CamelModel):
    access_starts_at: date | datetime | None = None


class ScopedGuestRelationRead(CamelModel):
    id: uuid.UUID
    owner_user_id: uuid.UUID
    guest_user_id: uuid.UUID
    scope_type: ScopeType
    scope_id: uuid.UUID
    access_starts_at: datetime
    is_active: bool


class ScopedGuestInvitationRead(CamelModel):
    id: uuid.UUID
    owner_user_id: uuid.UUID
    email: str
    scope_type: ScopeType
    scope_id: uuid.UUID
    access_starts_at: datetime
    status: str
    is_active: bool


class AccessGuestRead(CamelModel):
    guest_user_id: uuid.UUID
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    access_starts_at: datetime
    source_scope: ScopeType


class DeviceAccessContextRead(CamelModel):
    device_id: uuid.UUID
    environment_id: uuid.UUID
    owner_user_id: uuid.UUID
    actor_user_id: uuid.UUID
    is_owner: bool
    is_guest: bool
    can_read_movements: bool
    can_manage_guests: bool
    can_operate_device: bool
    guests: list[AccessGuestRead]
    pending_invitations: list[ScopedGuestInvitationRead] = []


class InvitationDetailsRead(CamelModel):
    id: uuid.UUID
    email: str
    status: str
    owner_email: str
    scope_type: ScopeType
    scope_name: str
    scope_id: uuid.UUID
    environment_id: uuid.UUID
    environment_name: str
    is_active: bool
    invited_user_exists: bool = False
