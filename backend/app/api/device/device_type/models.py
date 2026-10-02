import re
import uuid
from datetime import datetime
from typing import Any, List, Optional, TYPE_CHECKING

from pydantic import Field as PydanticField, field_validator, model_validator
from sqlalchemy import CheckConstraint, Column, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, Relationship, SQLModel, func

from app.core.time import utc_now
from app.core.utils import CamelModel
from app.api.sensor_catalog.schemas import SensorVariableRead

if TYPE_CHECKING:
    from app.api.device.models import Device

CODE_PATTERN = re.compile(r"[a-z][a-z0-9]*(_[a-z0-9]+)*\Z")

TELEMETRY_INTERVAL_RANGE = (5, 86400)
OFFLINE_AFTER_RANGE = (10, 604800)
MAX_COUNT_LIMIT = 64
MIN_SENSORS_LIMIT = 256


class DeviceTypeBase(SQLModel):
    name: str


class DeviceTypeCatalog(DeviceTypeBase, table=True):
    __tablename__ = "device_type"  # type: ignore[assignment]
    __table_args__ = (
        UniqueConstraint("name", name="uq_device_type_name"),
        UniqueConstraint("code", name="uq_device_type_code"),
        CheckConstraint(
            "telemetry_interval_s IS NULL OR telemetry_interval_s BETWEEN 5 AND 86400",
            name="ck_device_type_telemetry_interval",
        ),
        CheckConstraint(
            "offline_after_s IS NULL OR offline_after_s BETWEEN 10 AND 604800",
            name="ck_device_type_offline_after",
        ),
        CheckConstraint("min_sensors >= 0", name="ck_device_type_min_sensors"),
        # The config_template object-shape CHECK (jsonb_typeof has no SQLite
        # equivalent) lives in the PostgreSQL migration only.
    )

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    code: Optional[str] = Field(default=None)
    description: Optional[str] = Field(default=None)
    hardware_model: Optional[str] = Field(default=None)
    telemetry_interval_s: Optional[int] = Field(default=None)
    offline_after_s: Optional[int] = Field(default=None)
    min_sensors: int = Field(default=0)
    config_template: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="{}"),
    )
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: Optional[datetime] = Field(
        default=None,
        sa_column_kwargs={"onupdate": func.now()},
    )

    devices: List["Device"] = Relationship(
        back_populates="type",
        sa_relationship_kwargs={"lazy": "selectin"},
    )


class DeviceTypeSensor(SQLModel, table=True):
    """A sensor model a device type can carry, with its quantity and kit rules."""

    __tablename__ = "device_type_sensor"  # type: ignore[assignment]
    __table_args__ = (CheckConstraint("max_count >= 1", name="ck_device_type_sensor_max_count"),)

    device_type_id: uuid.UUID = Field(
        sa_column=Column(
            ForeignKey("device_type.id", ondelete="CASCADE"), primary_key=True, nullable=False
        )
    )
    sensor_id: uuid.UUID = Field(foreign_key="sensor.id", primary_key=True)
    required: bool = Field(default=False)
    max_count: int = Field(default=1)
    included_by_default: bool = Field(default=False)


# --- DTOs ---


class DeviceTypeRead(CamelModel):
    """Compact projection embedded in device payloads."""

    id: uuid.UUID
    is_active: bool
    name: str
    code: Optional[str] = None


class DeviceTypeSensorInput(CamelModel):
    sensor_id: uuid.UUID
    required: bool = False
    max_count: int = PydanticField(default=1, ge=1, le=MAX_COUNT_LIMIT)
    included_by_default: bool = False


class DeviceTypeSensorRead(CamelModel):
    sensor_id: uuid.UUID
    code: str
    name: str
    manufacturer: str
    is_active: bool
    required: bool
    max_count: int
    included_by_default: bool
    variables: list[SensorVariableRead]


class DeviceTypeAdminRead(CamelModel):
    id: uuid.UUID
    code: Optional[str] = None
    name: str
    description: Optional[str] = None
    hardware_model: Optional[str] = None
    telemetry_interval_s: Optional[int] = None
    offline_after_s: Optional[int] = None
    min_sensors: int
    config_template: dict[str, Any]
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    sensors: list[DeviceTypeSensorRead]


def _clean_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _validate_intervals(telemetry: Optional[int], offline: Optional[int]) -> None:
    if telemetry is not None and not TELEMETRY_INTERVAL_RANGE[0] <= telemetry <= TELEMETRY_INTERVAL_RANGE[1]:
        raise ValueError("telemetryIntervalS must be between 5 and 86400 seconds")
    if offline is not None and not OFFLINE_AFTER_RANGE[0] <= offline <= OFFLINE_AFTER_RANGE[1]:
        raise ValueError("offlineAfterS must be between 10 and 604800 seconds")
    if telemetry is not None and offline is not None and offline < telemetry:
        raise ValueError("offlineAfterS must be greater than or equal to telemetryIntervalS")


class _DeviceTypeFields(CamelModel):
    @field_validator("description", "hardware_model", check_fields=False)
    @classmethod
    def _text(cls, value: Optional[str]) -> Optional[str]:
        return _clean_text(value)

    @field_validator("name", check_fields=False)
    @classmethod
    def _name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("name cannot be empty")
        return value

    @field_validator("sensors", check_fields=False)
    @classmethod
    def _unique_sensors(cls, rows: Optional[list[DeviceTypeSensorInput]]):
        if rows is not None and len({row.sensor_id for row in rows}) != len(rows):
            raise ValueError("sensors cannot contain duplicates")
        return rows

    @field_validator("config_template", check_fields=False)
    @classmethod
    def _object(cls, value: Any):
        if value is not None and not isinstance(value, dict):
            raise ValueError("configTemplate must be a JSON object")
        return value


class DeviceTypeCreate(_DeviceTypeFields):
    code: str
    name: str
    description: Optional[str] = None
    hardware_model: Optional[str] = None
    telemetry_interval_s: Optional[int] = None
    offline_after_s: Optional[int] = None
    min_sensors: int = PydanticField(default=0, ge=0, le=MIN_SENSORS_LIMIT)
    config_template: dict[str, Any] = PydanticField(default_factory=dict)
    sensors: list[DeviceTypeSensorInput] = PydanticField(default_factory=list)

    @field_validator("code")
    @classmethod
    def _code(cls, value: str) -> str:
        if not CODE_PATTERN.fullmatch(value):
            raise ValueError("code must be a lowercase slug")
        return value

    @model_validator(mode="after")
    def _intervals(self):
        _validate_intervals(self.telemetry_interval_s, self.offline_after_s)
        return self


class DeviceTypeUpdate(_DeviceTypeFields):
    """Partial update; ``code`` is accepted only to report that it is immutable."""

    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    hardware_model: Optional[str] = None
    telemetry_interval_s: Optional[int] = None
    offline_after_s: Optional[int] = None
    min_sensors: Optional[int] = PydanticField(default=None, ge=0, le=MIN_SENSORS_LIMIT)
    config_template: Optional[dict[str, Any]] = None
    is_active: Optional[bool] = None
    sensors: Optional[list[DeviceTypeSensorInput]] = None

    @model_validator(mode="after")
    def _intervals(self):
        _validate_intervals(self.telemetry_interval_s, self.offline_after_s)
        return self
