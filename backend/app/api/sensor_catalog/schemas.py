"""Public projections and validated device-sensor mutations."""

import re
import uuid
from datetime import datetime
from typing import Any

from pydantic import Field, field_validator, model_validator

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


class VariableAdminRead(VariableRead):
    description: str | None
    is_active: bool


class VariableCreate(CamelModel):
    code: str
    name: str = Field(min_length=1)
    unit: str = Field(min_length=1)
    description: str | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, code: str) -> str:
        if not KEY_PATTERN.fullmatch(code):
            raise ValueError("code must be a lowercase slug")
        return code


class VariablePatch(CamelModel):
    code: str | None = None
    name: str | None = Field(default=None, min_length=1)
    unit: str | None = Field(default=None, min_length=1)
    description: str | None = None
    is_active: bool | None = None


class SensorVariableInput(CamelModel):
    variable_id: uuid.UUID
    min_value: float = Field(allow_inf_nan=False)
    max_value: float = Field(allow_inf_nan=False)
    accuracy: str = Field(min_length=1)
    resolution: str = Field(min_length=1)

    @model_validator(mode="after")
    def valid_range(self):
        if self.min_value > self.max_value:
            raise ValueError("minValue must be less than or equal to maxValue")
        return self


class SensorAdminVariableRead(SensorVariableInput):
    code: str
    name: str
    unit: str


class SensorAdminRead(CamelModel):
    id: uuid.UUID
    code: str
    name: str
    manufacturer: str
    description: str | None
    is_active: bool
    variables: list[SensorAdminVariableRead]


class SensorCreate(CamelModel):
    code: str
    name: str = Field(min_length=1)
    manufacturer: str = Field(min_length=1)
    description: str | None = None
    variables: list[SensorVariableInput] = Field(default_factory=list)

    @field_validator("code")
    @classmethod
    def validate_code(cls, code: str) -> str:
        return VariableCreate.validate_code(code)

    @field_validator("variables")
    @classmethod
    def unique_variables(cls, rows: list[SensorVariableInput]) -> list[SensorVariableInput]:
        if len({row.variable_id for row in rows}) != len(rows):
            raise ValueError("variables cannot contain duplicates")
        return rows


class SensorPatch(CamelModel):
    code: str | None = None
    name: str | None = Field(default=None, min_length=1)
    manufacturer: str | None = Field(default=None, min_length=1)
    description: str | None = None
    is_active: bool | None = None
    variables: list[SensorVariableInput] | None = None

    @field_validator("variables")
    @classmethod
    def unique_variables(cls, rows: list[SensorVariableInput] | None):
        return SensorCreate.unique_variables(rows) if rows is not None else None


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
