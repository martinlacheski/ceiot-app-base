"""SQLModel tables for sensor capabilities and installed device sensors."""

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import field_validator
from sqlalchemy import CheckConstraint, Column, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Variable(SQLModel, table=True):
    __tablename__ = "variable"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    code: str = Field(unique=True, index=True)
    name: str
    unit: str
    description: str | None = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now, sa_column_kwargs={"onupdate": func.now()})


class Sensor(SQLModel, table=True):
    __tablename__ = "sensor"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    code: str = Field(unique=True, index=True)
    name: str
    manufacturer: str
    description: str | None = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now, sa_column_kwargs={"onupdate": func.now()})


class SensorVariable(SQLModel, table=True):
    __tablename__ = "sensor_variable"
    __table_args__ = (CheckConstraint("min_value <= max_value", name="ck_sensor_variable_range"),)

    sensor_id: uuid.UUID = Field(foreign_key="sensor.id", primary_key=True)
    variable_id: uuid.UUID = Field(foreign_key="variable.id", primary_key=True)
    min_value: float
    max_value: float
    accuracy: str
    resolution: str


class DeviceSensor(SQLModel, table=True):
    __tablename__ = "device_sensor"
    __table_args__ = (
        UniqueConstraint("device_id", "key", name="uq_device_sensor_device_key"),
        # The key-slug and config object-shape CHECKs (jsonb_typeof has no
        # SQLite equivalent) are enforced by the PostgreSQL migration, which
        # is the source of truth for PostgreSQL-only DDL.
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    device_id: uuid.UUID = Field(sa_column=Column(ForeignKey("device.id", ondelete="CASCADE"), nullable=False, index=True))
    sensor_id: uuid.UUID = Field(foreign_key="sensor.id", index=True)
    key: str
    config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False, server_default="{}"))
    is_active: bool = True
    installed_at: datetime = Field(default_factory=utc_now)
    removed_at: datetime | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now, sa_column_kwargs={"onupdate": func.now()})

    @field_validator("key")
    @classmethod
    def validate_key(cls, value: str) -> str:
        if not re.fullmatch(r"[a-z][a-z0-9]*(?:_[a-z0-9]+)*", value):
            raise ValueError("key must be a lowercase slug")
        return value
