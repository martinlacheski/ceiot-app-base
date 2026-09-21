import uuid
from datetime import datetime
from typing import List, Optional, TYPE_CHECKING
from sqlmodel import Field, SQLModel, Relationship, func
from app.api.location.models import LocationCity
from app.api.environment.environment_type.models import EnvironmentType
from app.api.environment.environment_type.models import EnvironmentTypeRead
from app.core.utils import CamelModel
from app.api.location.models import LocationCityRead

if TYPE_CHECKING:
    from app.api.environment.invitation.models import EnvironmentInvitation
    from app.api.auth.models import User

# Environment
class EnvironmentBase(SQLModel):
    name: str
    address: str
    location: str
    description: str
    phone: Optional[str] = Field(default=None)
    city_id: uuid.UUID = Field(foreign_key="locationcity.id")
    type_id: uuid.UUID = Field(foreign_key="environmenttype.id")

class Environment(EnvironmentBase, table=True):
    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    is_active: bool = Field(default=True)
    is_public_map_visible: bool = Field(default=False)
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})

    # Relationships
    type: Optional[EnvironmentType] = Relationship(back_populates="environments")
    city: Optional[LocationCity] = Relationship()
    users: List["EnvironmentUser"] = Relationship(back_populates="environment")
    invitations: List["EnvironmentInvitation"] = Relationship(back_populates="environment")

    @property
    def owner_name(self) -> Optional[str]:
        if self.users:
            for u in self.users:
                if u.is_owner and u.user:
                    return f"{u.user.first_name} {u.user.last_name}".strip() or u.user.username
        return None

    @property
    def owner_id(self) -> Optional[uuid.UUID]:
        if self.users:
            for u in self.users:
                if u.is_owner:
                    return u.user_id
        return None

class EnvironmentUser(SQLModel, table=True):
    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    environment_id: uuid.UUID = Field(foreign_key="environment.id")
    user_id: uuid.UUID = Field(foreign_key="user.id")
    is_owner: bool = Field(default=False)
    is_active: bool = Field(default=True)
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})
    
    environment: "Environment" = Relationship(back_populates="users")
    user: "User" = Relationship()

# DTOs
class EnvironmentCreate(EnvironmentBase, CamelModel):
    is_active: bool = Field(default=True)
    is_public_map_visible: bool = Field(default=False)

class EnvironmentRead(CamelModel):
    id: uuid.UUID
    name: str
    address: str
    location: str
    description: str
    phone: str | None = None
    city_id: uuid.UUID
    type_id: uuid.UUID
    is_active: bool
    is_public_map_visible: bool
    type: EnvironmentTypeRead | None = None
    city: LocationCityRead | None = None
    owner_name: str | None = None
    owner_id: uuid.UUID | None = None
    current_user_role: str | None = None
    can_edit: bool = False
    can_delete: bool = False


class EnvironmentEmbeddedRead(CamelModel):
    id: uuid.UUID
    name: str
    address: str
    location: str
    description: str
    phone: str | None = None
    city_id: uuid.UUID
    type_id: uuid.UUID
    is_active: bool
    is_public_map_visible: bool
    type: EnvironmentTypeRead | None = None
    city: LocationCityRead | None = None
    owner_name: str | None = None
    owner_id: uuid.UUID | None = None
    current_user_role: str | None = None
    can_edit: bool = False
    can_delete: bool = False

class EnvironmentUpdate(CamelModel):
    name: str | None = None
    address: str | None = None
    location: str | None = None
    description: str | None = None
    phone: str | None = None
    city_id: uuid.UUID | None = None
    type_id: uuid.UUID | None = None
    is_active: bool | None = None
    is_public_map_visible: bool | None = None
