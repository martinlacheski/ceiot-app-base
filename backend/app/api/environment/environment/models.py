import uuid
from datetime import datetime
from typing import List, Optional, TYPE_CHECKING
from pydantic import model_validator
from sqlalchemy import CheckConstraint, Index, event, inspect as sa_inspect, text
from sqlmodel import Field, SQLModel, Relationship, func
from app.core.coordinates import format_location, in_range, parse_lat_lng
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
    # Deprecated legacy text mirror of latitude/longitude ("lat,lng"); kept in sync
    # by the mapper hook below until every reader moved to the numeric columns.
    location: str = ""
    description: str
    phone: Optional[str] = Field(default=None)
    city_id: uuid.UUID = Field(foreign_key="locationcity.id")
    type_id: uuid.UUID = Field(foreign_key="environmenttype.id")

class Environment(EnvironmentBase, table=True):
    # Portable (SQLite unit tests + PostgreSQL): the migration creates the same constraint.
    __table_args__ = (
        CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL "
            "AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)",
            name="ck_environment_coordinates_valid",
        ),
    )

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    is_active: bool = Field(default=True)
    is_public_map_visible: bool = Field(default=False)
    latitude: Optional[float] = Field(default=None)
    longitude: Optional[float] = Field(default=None)
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

def _sync_environment_coordinates(mapper, connection, environment: "Environment") -> None:
    """Keep ``location`` (legacy text) and ``latitude``/``longitude`` (truth) consistent.

    Numeric coordinates win when they are written; otherwise a written ``location`` is
    parsed (text without a valid in-range pair clears the numeric columns).
    """
    state = sa_inspect(environment)

    def written(attr: str) -> bool:
        history = state.attrs[attr].history
        return bool(history.added) if state.persistent else getattr(environment, attr) is not None

    coordinates_written = (
        (written("latitude") or written("longitude"))
        and environment.latitude is not None
        and environment.longitude is not None
        and in_range(environment.latitude, environment.longitude)
    )
    if coordinates_written:
        environment.location = format_location(environment.latitude, environment.longitude)
        return

    location_written = bool(environment.location) if not state.persistent else written("location")
    lone_or_invalid = (environment.latitude is None) != (environment.longitude is None) or (
        environment.latitude is not None and not in_range(environment.latitude, environment.longitude)
    )
    if location_written or lone_or_invalid:
        parsed = parse_lat_lng(environment.location)
        environment.latitude, environment.longitude = parsed if parsed else (None, None)


event.listen(Environment, "before_insert", _sync_environment_coordinates)
event.listen(Environment, "before_update", _sync_environment_coordinates)


class EnvironmentUser(SQLModel, table=True):
    # At most one active membership per (environment, user); inactive history rows may repeat.
    __table_args__ = (
        Index(
            "uq_environmentuser_active_member",
            "environment_id",
            "user_id",
            unique=True,
            postgresql_where=text("is_active"),
            sqlite_where=text("is_active"),
        ),
    )

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    environment_id: uuid.UUID = Field(foreign_key="environment.id")
    user_id: uuid.UUID = Field(foreign_key="user.id")
    is_owner: bool = Field(default=False)
    is_active: bool = Field(default=True)
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})
    
    environment: "Environment" = Relationship(back_populates="users")
    user: "User" = Relationship()

# DTOs
def _require_coordinate_pair(latitude: float | None, longitude: float | None) -> None:
    if (latitude is None) != (longitude is None):
        raise ValueError("latitude y longitude deben informarse juntas")


class EnvironmentCreate(EnvironmentBase, CamelModel):
    is_active: bool = Field(default=True)
    is_public_map_visible: bool = Field(default=False)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def _location_or_coordinates(self):
        _require_coordinate_pair(self.latitude, self.longitude)
        if not (self.location or "").strip() and self.latitude is None:
            raise ValueError("Se requiere location o latitude/longitude")
        return self

class EnvironmentRead(CamelModel):
    id: uuid.UUID
    name: str
    address: str
    location: str
    latitude: float | None = None
    longitude: float | None = None
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
    latitude: float | None = None
    longitude: float | None = None
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
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    description: str | None = None
    phone: str | None = None
    city_id: uuid.UUID | None = None
    type_id: uuid.UUID | None = None
    is_active: bool | None = None
    is_public_map_visible: bool | None = None

    @model_validator(mode="after")
    def _coordinates_travel_together(self):
        _require_coordinate_pair(self.latitude, self.longitude)
        return self
