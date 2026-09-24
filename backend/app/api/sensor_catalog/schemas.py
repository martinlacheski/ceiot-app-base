"""Public projections and validated device-sensor mutations."""

import re
import uuid
from datetime import datetime
from typing import Any

from pydantic import Field, field_validator

from app.core.utils import CamelModel


KEY_PATTERN = re.compile(r"[a-z][a-z0-9]*(_[a-z0-9]+)*\Z")


def next_sensor_key(code: str, used: set[str]) -> str:
    """Choose the same per-device slug for all installation paths."""
    if code not in used:
        return code
    index = 2
    while f"{code}_{index}" in used:
        index += 1
    return f"{code}_{index}"


class VariableRead(CamelModel):
    id: uuid.UUID
    code: str
    name: str
    unit: str


class SensorVariableRead(CamelModel):
    code: str
    name: str
    unit: str
    min: float
    max: float
    accuracy: str
    resolution: str


class SensorRead(CamelModel):
    id: uuid.UUID
    code: str
    name: str
    manufacturer: str
    variables: list[SensorVariableRead]


class DeviceSensorCreate(CamelModel):
    sensor_id: uuid.UUID
    key: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("key")
    @classmethod
    def validate_key(cls, value: str | None) -> str | None:
        if value is not None and not KEY_PATTERN.fullmatch(value):
            raise ValueError("key must be a lowercase slug")
        return value


class DeviceSensorPatch(CamelModel):
    key: str | None = None
    config: dict[str, Any] | None = None
    is_active: bool | None = None

    @field_validator("key")
    @classmethod
    def validate_key(cls, value: str | None) -> str | None:
        return DeviceSensorCreate.validate_key(value)


class DeviceSensorRead(CamelModel):
    id: uuid.UUID
    device_id: uuid.UUID
    sensor_id: uuid.UUID
    key: str
    config: dict[str, Any]
    is_active: bool
    installed_at: datetime | None = None
    removed_at: datetime | None = None
