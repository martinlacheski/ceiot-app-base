import uuid
from datetime import datetime
from typing import List, Optional
from sqlalchemy import Index, text
from sqlmodel import Field, SQLModel, Relationship, func
from app.core.utils import CamelModel


# Base Classes
class LocationCountryBase(SQLModel):
    name: str = Field(index=True)

class LocationStateBase(SQLModel):
    name: str = Field(index=True)
    country_id: uuid.UUID = Field(foreign_key="locationcountry.id")

class LocationCityBase(SQLModel):
    name: str = Field(index=True)
    postal_code: str
    state_id: uuid.UUID = Field(foreign_key="locationstate.id")

# Models

# Names are unique case-insensitively (the services already compare lower(name)); the
# expression indexes are portable to the SQLite unit tests and mirror the migration.
class LocationCountry(LocationCountryBase, table=True):
    __table_args__ = (Index("uq_locationcountry_lower_name", text("lower(name)"), unique=True),)

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    is_active: bool = Field(default=True)
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})
    states: List["LocationState"] = Relationship(back_populates="country")

class LocationState(LocationStateBase, table=True):
    __table_args__ = (
        Index("uq_locationstate_country_lower_name", "country_id", text("lower(name)"), unique=True),
    )

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    is_active: bool = Field(default=True)
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})
    country: LocationCountry = Relationship(back_populates="states")
    cities: List["LocationCity"] = Relationship(back_populates="state")

class LocationCity(LocationCityBase, table=True):
    __table_args__ = (
        Index("uq_locationcity_state_lower_name", "state_id", text("lower(name)"), unique=True),
    )

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    is_active: bool = Field(default=True)
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})
    state: LocationState = Relationship(back_populates="cities")


# DTOs

# Country
class LocationCountryCreate(LocationCountryBase):
    pass

class LocationCountryRead(CamelModel):
    id: uuid.UUID
    name: str
    is_active: bool

class LocationCountryUpdate(SQLModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None

# State
class LocationStateCreate(LocationStateBase):
    pass

class LocationStateRead(CamelModel):
    id: uuid.UUID
    name: str
    is_active: bool
    country: Optional[LocationCountryRead] = None

class LocationStateUpdate(SQLModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    country_id: Optional[uuid.UUID] = None

# City
class LocationCityCreate(LocationCityBase):
    pass

class LocationCityRead(CamelModel):
    id: uuid.UUID
    name: str
    postal_code: Optional[str] = None
    is_active: bool
    state: Optional[LocationStateRead] = None

class LocationCityUpdate(SQLModel):
    name: Optional[str] = None
    postal_code: Optional[str] = None
    is_active: Optional[bool] = None
    state_id: Optional[uuid.UUID] = None
