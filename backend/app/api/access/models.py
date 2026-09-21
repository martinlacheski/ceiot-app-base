import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, Enum as SAEnum, Index, func, text
from sqlmodel import Field, SQLModel
from app.core.time import utc_now


class ScopeType(str, Enum):
    ENVIRONMENT = "environment"
    DEVICE = "device"


class InvitationStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    REVOKED = "revoked"


scope_type_sa_enum = SAEnum(
    ScopeType,
    name="scopetype",
    values_callable=lambda enum_cls: [item.value for item in enum_cls],
)

invitation_status_sa_enum = SAEnum(
    InvitationStatus,
    name="invitationstatus",
    values_callable=lambda enum_cls: [item.value for item in enum_cls],
)


class ScopedGuestRelation(SQLModel, table=True):
    __tablename__ = "scoped_guest_relation"
    __table_args__ = (
        Index("ix_scoped_guest_relation_scope", "scope_type", "scope_id"),
        Index(
            "uq_scoped_guest_relation_active_scope_guest",
            "scope_type",
            "scope_id",
            "guest_user_id",
            unique=True,
            postgresql_where=text("is_active = true"),
            sqlite_where=text("is_active = 1"),
        ),
    )

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_user_id: uuid.UUID = Field(foreign_key="user.id", index=True)
    guest_user_id: uuid.UUID = Field(foreign_key="user.id", index=True)
    scope_type: ScopeType = Field(sa_column=Column(scope_type_sa_enum, nullable=False, index=True))
    scope_id: uuid.UUID = Field(index=True)
    access_starts_at: datetime = Field(default_factory=utc_now, nullable=False)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: Optional[datetime] = Field(
        default=None,
        sa_column_kwargs={"onupdate": func.now()},
    )


class ScopedGuestInvitation(SQLModel, table=True):
    __tablename__ = "scoped_guest_invitation"
    __table_args__ = (
        Index("ix_scoped_guest_invitation_scope", "scope_type", "scope_id"),
    )

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_user_id: uuid.UUID = Field(foreign_key="user.id", index=True)
    email: str = Field(index=True)
    scope_type: ScopeType = Field(sa_column=Column(scope_type_sa_enum, nullable=False, index=True))
    scope_id: uuid.UUID = Field(index=True)
    access_starts_at: datetime = Field(default_factory=utc_now, nullable=False)
    status: InvitationStatus = Field(
        default=InvitationStatus.PENDING,
        sa_column=Column(invitation_status_sa_enum, nullable=False),
    )
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: Optional[datetime] = Field(
        default=None,
        sa_column_kwargs={"onupdate": func.now()},
    )
    processed_at: Optional[datetime] = Field(default=None)

