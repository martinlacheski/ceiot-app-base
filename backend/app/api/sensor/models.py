import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, DateTime, ForeignKey, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB


class SensorReading(SQLModel, table=True):
    """
    Almacena lecturas periódicas de sensores IoT.
    Esta tabla se configurará como Hypertable de TimescaleDB.
    """
    # TimescaleDB usa 'time' como dimensión de particionamiento
    time: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            primary_key=True,
            server_default=func.now()
        )
    )
    
    # ID único para cada lectura
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    
    # Identificación del dispositivo
    device_id: Optional[uuid.UUID] = Field(default=None, foreign_key="device.id", index=True)
    device_serial: str = Field(index=True)  # Redundante pero útil
    environment_id: Optional[uuid.UUID] = Field(
        default=None,
        sa_column=Column(
            Uuid(),
            ForeignKey("environment.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    device_type: str = Field(default="generic")
    
    # Generic device-health signals
    power_supply_state: Optional[bool] = Field(default=None)

    # Environmental measurements
    temperature_c: Optional[float] = Field(default=None)
    relative_humidity_pct: Optional[float] = Field(default=None)
    pressure_hpa: Optional[float] = Field(default=None)
    
    # Telemetría del Dispositivo
    uptime: Optional[int] = Field(default=None)
    firmware_version: Optional[str] = Field(default=None)
    reset_reason: Optional[str] = Field(default=None)
    heap_free: Optional[int] = Field(default=None)
    wifi_rssi: Optional[int] = Field(default=None)
    wifi_ssid: Optional[str] = Field(default=None)
    wifi_ip: Optional[str] = Field(default=None)
    last_error: Optional[str] = Field(default=None)
    
    # Metadata adicional (para campos futuros sin migración)
    extra_data: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    
    # Timestamp del dispositivo (puede diferir de 'time')
    device_datetime: Optional[str] = Field(default=None)


class Telemetry(SQLModel, table=True):
    """Per-device measurements grouped by installed sensor key."""

    __tablename__ = "telemetry"
    # The "values" JSONB object-shape CHECK is enforced by the PostgreSQL
    # migration (jsonb_typeof), not here: jsonb_typeof has no SQLite
    # equivalent, and the migration is the source of truth for PostgreSQL DDL.

    time: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), primary_key=True, server_default=func.now()),
    )
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    device_id: uuid.UUID | None = Field(default=None, foreign_key="device.id")
    device_serial: str
    environment_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(), ForeignKey("environment.id", ondelete="SET NULL"), nullable=True),
    )
    values: dict = Field(sa_column=Column(JSONB, nullable=False))
