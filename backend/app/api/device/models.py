from app.api.environment.environment.models import EnvironmentEmbeddedRead
import uuid
from datetime import date, datetime
from enum import Enum
from typing import List, Optional
from sqlmodel import Field, SQLModel, Relationship, func
from app.api.device.device_type.constants import (
    DEFAULT_DEVICE_TYPE_ID,
)
from app.api.device.device_type.models import DeviceTypeCatalog, DeviceTypeRead
from app.core.utils import CamelModel

from app.api.environment.environment.models import Environment


class DeviceStatus(str, Enum):
    NEW = "new"           # Created, not paired
    PAIRED = "paired"     # Linked to an environment
    ACTIVE = "active"     # Online/Working
    MAINTENANCE = "maintenance"
    UNPAIRED = "unpaired"  # Was paired, now free


class DeviceEffectiveLocationSource(str, Enum):
    DEVICE_GPS = "device_gps"
    ENVIRONMENT = "environment"

# --- Database Models ---


class DeviceBase(SQLModel):
    serial: str = Field(index=True, unique=True)
    name: str
    description: Optional[str] = Field(default=None)
    model: Optional[str] = Field(default=None)
    batch: Optional[str] = Field(default=None)
    firmware_version: Optional[str] = Field(default=None)
    ip_address: Optional[str] = Field(default=None)
    mac_address: Optional[str] = Field(default=None)
    rssi: Optional[int] = Field(default=None)
    wifi_ssid: Optional[str] = Field(default=None)
    last_reset_reason: Optional[str] = Field(default=None)
    gps_latitude: Optional[float] = Field(default=None)
    gps_longitude: Optional[float] = Field(default=None)
    gps_updated_at: Optional[datetime] = Field(default=None)
    manufacture_date: Optional[date] = Field(default=None)
    status: DeviceStatus = Field(default=DeviceStatus.NEW)
    is_active: bool = Field(default=True)
    enabled: bool = Field(default=True)
    last_connection: Optional[datetime] = Field(default=None)
    broker_connected: bool = Field(default=False)
    broker_connected_at: Optional[datetime] = Field(default=None)
    broker_disconnected_at: Optional[datetime] = Field(default=None)
    broker_status_updated_at: Optional[datetime] = Field(default=None)
    environment_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="environment.id")


class Device(DeviceBase, table=True):
    id: Optional[uuid.UUID] = Field(
        default_factory=uuid.uuid4, primary_key=True)
    device_type_id: uuid.UUID = Field(
        default=DEFAULT_DEVICE_TYPE_ID,
        foreign_key="device_type.id",
        index=True,
    )
    updated_at: Optional[datetime] = Field(
        default=None, sa_column_kwargs={"onupdate": func.now()})

    # Relationships
    environment: Optional["Environment"] = Relationship()
    type: Optional[DeviceTypeCatalog] = Relationship(back_populates="devices")
    location_reports: List["DeviceLocationReport"] = Relationship(
        sa_relationship_kwargs={"lazy": "noload"}, back_populates="device"
    )

    @property
    def effective_location(self) -> Optional[str]:
        if self.gps_latitude is not None and self.gps_longitude is not None:
            return f"{self.gps_latitude},{self.gps_longitude}"

        environment_location = (
            self.environment.location.strip()
            if self.environment and self.environment.location
            else ""
        )
        return environment_location or None

    @property
    def effective_location_source(self) -> Optional[DeviceEffectiveLocationSource]:
        if self.gps_latitude is not None and self.gps_longitude is not None:
            return DeviceEffectiveLocationSource.DEVICE_GPS
        if self.environment and self.environment.location and self.environment.location.strip():
            return DeviceEffectiveLocationSource.ENVIRONMENT
        return None

class DeviceLocationReport(SQLModel, table=True):
    __tablename__ = "device_location_report"

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    device_id: uuid.UUID = Field(foreign_key="device.id", index=True)
    latitude: float
    longitude: float
    reported_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)

    device: "Device" = Relationship(back_populates="location_reports")

# --- DTOs (Pydantic Schemas) ---


class DeviceCreate(CamelModel):
    serial: str  # Validated in service
    name: str
    description: Optional[str] = None
    device_type_id: Optional[uuid.UUID] = None
    model: Optional[str] = None
    batch: Optional[str] = None
    manufacture_date: Optional[date] = None


class DeviceUpdate(CamelModel):
    name: Optional[str] = None
    description: Optional[str] = None
    device_type_id: Optional[uuid.UUID] = None
    enabled: Optional[bool] = None
    is_active: Optional[bool] = None


class DeviceRead(CamelModel):
    id: uuid.UUID
    serial: str
    name: str
    description: Optional[str] = None
    device_type_id: uuid.UUID
    model: Optional[str] = None
    batch: Optional[str] = None
    firmware_version: Optional[str] = None
    ip_address: Optional[str] = None
    mac_address: Optional[str] = None
    rssi: Optional[int] = None
    wifi_ssid: Optional[str] = None
    last_reset_reason: Optional[str] = None
    gps_latitude: Optional[float] = None
    gps_longitude: Optional[float] = None
    gps_updated_at: Optional[datetime] = None
    effective_location: Optional[str] = None
    effective_location_source: Optional[DeviceEffectiveLocationSource] = None
    manufacture_date: Optional[date] = None
    status: DeviceStatus
    is_active: bool
    enabled: bool
    last_connection: Optional[datetime] = None
    broker_connected: bool
    broker_connected_at: Optional[datetime] = None
    broker_disconnected_at: Optional[datetime] = None
    broker_status_updated_at: Optional[datetime] = None
    environment_id: Optional[uuid.UUID] = None
    type: Optional[DeviceTypeRead] = None
    environment: Optional["EnvironmentEmbeddedRead"] = None


class DeviceListResponse(CamelModel):
    items: List[DeviceRead]
    total: int
    page: int
    per_page: int
    pages: int


class DevicePairingRequest(CamelModel):
    serial: str
    environment_id: uuid.UUID
    description: str = Field(min_length=1)
