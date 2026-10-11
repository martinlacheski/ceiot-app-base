from app.api.environment.environment.models import EnvironmentEmbeddedRead
import uuid
from datetime import date, datetime, timezone
from enum import Enum
from typing import List, Optional
from pydantic import AliasChoices, Field as PydanticField
from sqlalchemy import Column, DateTime, false
from sqlmodel import Field, SQLModel, Relationship, func
from app.api.device.device_type.constants import (
    DEFAULT_DEVICE_TYPE_ID,
)
from app.api.device.device_type.models import DeviceTypeCatalog, DeviceTypeRead
from app.core.utils import CamelModel
from app.api.sensor_catalog.schemas import DeviceSensorCreate

from app.api.environment.environment.models import Environment
from app.core.time import UTCDateTime, utc_now


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
    # Per-unit override of the type's ``hardware_model``; NULL means "use the type's model".
    # Read it through ``effective_model`` (or ``effective_model_expression()`` in SQL).
    model: Optional[str] = Field(default=None)
    batch: Optional[str] = Field(default=None)
    # Identifies the hardware unit (reported by the device, but not volatile state).
    mac_address: Optional[str] = Field(default=None)
    manufacture_date: Optional[date] = Field(default=None)
    status: DeviceStatus = Field(default=DeviceStatus.NEW)
    is_active: bool = Field(default=True)
    enabled: bool = Field(default=True)
    environment_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="environment.id")


class DeviceState(SQLModel, table=True):
    """Last-known runtime state of a device (1:1), upserted by the MQTT runtime.

    Kept out of ``device`` so the per-message runtime writes never touch the device row
    (``device.updated_at`` only moves on real edits). A device that never reported has no row:
    readers go through ``Device``'s read-only properties, which fall back to NULL / False.
    """

    __tablename__ = "device_state"

    device_id: uuid.UUID = Field(foreign_key="device.id", primary_key=True, ondelete="CASCADE")
    firmware_version: Optional[str] = Field(default=None)
    ip_address: Optional[str] = Field(default=None)
    rssi: Optional[int] = Field(default=None)
    wifi_ssid: Optional[str] = Field(default=None)
    last_reset_reason: Optional[str] = Field(default=None)
    gps_latitude: Optional[float] = Field(default=None)
    gps_longitude: Optional[float] = Field(default=None)
    gps_updated_at: Optional[datetime] = Field(default=None, sa_type=UTCDateTime)
    last_connection: Optional[datetime] = Field(default=None, sa_type=UTCDateTime)
    broker_connected: bool = Field(default=False, sa_column_kwargs={"server_default": false()})
    broker_connected_at: Optional[datetime] = Field(default=None, sa_type=UTCDateTime)
    broker_disconnected_at: Optional[datetime] = Field(default=None, sa_type=UTCDateTime)
    broker_status_updated_at: Optional[datetime] = Field(default=None, sa_type=UTCDateTime)
    updated_at: Optional[datetime] = Field(default=None, sa_type=UTCDateTime)


def _state_property(name: str, default=None) -> property:
    """A read-only ``Device`` attribute backed by its ``DeviceState`` column (``default`` when
    the device never reported). Writers go through ``DeviceRepository`` upserts."""

    def read(device: "Device"):
        state = device.state
        return default if state is None else getattr(state, name)

    return property(read, doc=f"``device_state.{name}`` (read-only).")


class Device(DeviceBase, table=True):
    id: Optional[uuid.UUID] = Field(
        default_factory=uuid.uuid4, primary_key=True)
    device_type_id: uuid.UUID = Field(
        default=DEFAULT_DEVICE_TYPE_ID,
        foreign_key="device_type.id",
        index=True,
    )
    updated_at: Optional[datetime] = Field(
        default=None, sa_type=UTCDateTime, sa_column_kwargs={"onupdate": func.now()})
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now()),
    )

    # Relationships
    environment: Optional["Environment"] = Relationship()
    type: Optional[DeviceTypeCatalog] = Relationship(back_populates="devices")
    location_reports: List["DeviceLocationReport"] = Relationship(
        sa_relationship_kwargs={"lazy": "noload"}, back_populates="device"
    )
    # Loaded with every device (selectin: one extra query per load, no outer join on the device
    # query, so pagination counts and FOR UPDATE stay unaffected). The database cascades deletes.
    state: Optional[DeviceState] = Relationship(
        sa_relationship_kwargs={
            "lazy": "selectin",
            "uselist": False,
            "cascade": "all, delete-orphan",
            "passive_deletes": True,
        }
    )

    firmware_version = _state_property("firmware_version")
    ip_address = _state_property("ip_address")
    rssi = _state_property("rssi")
    wifi_ssid = _state_property("wifi_ssid")
    last_reset_reason = _state_property("last_reset_reason")
    gps_latitude = _state_property("gps_latitude")
    gps_longitude = _state_property("gps_longitude")
    gps_updated_at = _state_property("gps_updated_at")
    last_connection = _state_property("last_connection")
    broker_connected = _state_property("broker_connected", False)
    broker_connected_at = _state_property("broker_connected_at")
    broker_disconnected_at = _state_property("broker_disconnected_at")
    broker_status_updated_at = _state_property("broker_status_updated_at")

    @property
    def effective_model(self) -> Optional[str]:
        """The unit's override, else its type's hardware model (needs ``type`` loaded)."""
        if self.model is not None:
            return self.model
        return self.type.hardware_model if self.type is not None else None

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


def normalize_model_override(requested: Optional[str], type_model: Optional[str]) -> Optional[str]:
    """The value to store in ``device.model``: None when blank or equal to the type's model.

    The comparison (trimmed, case-insensitive) matches migration 0024.
    """
    model = (requested or "").strip()
    if not model:
        return None
    if type_model is not None and model.lower() == type_model.strip().lower():
        return None
    return model


class DeviceLocationReport(SQLModel, table=True):
    __tablename__ = "device_location_report"

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    device_id: uuid.UUID = Field(foreign_key="device.id", index=True)
    latitude: float
    longitude: float
    reported_at: datetime = Field(sa_type=UTCDateTime)
    created_at: datetime = Field(default_factory=utc_now, sa_type=UTCDateTime)

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
    sensors: List[DeviceSensorCreate] = Field(default_factory=list)


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
    # The effective model: the unit's override, else the type's hardware model.
    model: Optional[str] = PydanticField(
        default=None, validation_alias=AliasChoices("effective_model", "model")
    )
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
    broker_connected: Optional[bool]
    broker_connected_at: Optional[datetime] = None
    broker_disconnected_at: Optional[datetime] = None
    broker_status_updated_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
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


class DeviceMoveRequest(CamelModel):
    environment_id: uuid.UUID
