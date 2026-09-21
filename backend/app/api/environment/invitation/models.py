import uuid
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from sqlmodel import Field, SQLModel, Relationship, text, func
from app.core.time import utc_now

if TYPE_CHECKING:
    from app.api.environment.environment.models import Environment

class EnvironmentInvitationBase(SQLModel):
    email: str
    status: str = Field(default="Pendiente") 
    environment_id: uuid.UUID = Field(foreign_key="environment.id")
    owner_id: uuid.UUID = Field(foreign_key="user.id")

class EnvironmentInvitation(EnvironmentInvitationBase, table=True):
    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utc_now, sa_column_kwargs={"server_default": text("CURRENT_TIMESTAMP")})
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})
    processed_at: Optional[datetime] = Field(default=None)
    
    environment: "Environment" = Relationship(back_populates="invitations")

class EnvironmentInvitationCreate(EnvironmentInvitationBase):
    pass

class EnvironmentInvitationRead(EnvironmentInvitationBase):
    id: uuid.UUID
    is_active: bool

class EnvironmentInvitationUpdate(SQLModel):
    status: Optional[str] = None
    is_active: Optional[bool] = None
