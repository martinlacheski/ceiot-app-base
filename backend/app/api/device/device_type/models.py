import uuid
from datetime import datetime
from typing import List, Optional, TYPE_CHECKING

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, Relationship, SQLModel, func

from app.core.utils import CamelModel

if TYPE_CHECKING:
    from app.api.device.models import Device


class DeviceTypeBase(SQLModel):
    name: str


class DeviceTypeCatalog(DeviceTypeBase, table=True):
    __tablename__ = "device_type"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint("name", name="uq_device_type_name"),
        UniqueConstraint("code", name="uq_device_type_code"),
    )

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    code: Optional[str] = Field(default=None)
    is_active: bool = Field(default=True)
    updated_at: Optional[datetime] = Field(
        default=None,
        sa_column_kwargs={"onupdate": func.now()},
    )

    devices: List["Device"] = Relationship(
        back_populates="type",
        sa_relationship_kwargs={"lazy": "selectin"},
    )


class DeviceTypeCreate(DeviceTypeBase):
    pass


class DeviceTypeRead(CamelModel):
    id: uuid.UUID
    is_active: bool
    name: str
    code: Optional[str] = None


class DeviceTypeUpdate(SQLModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
