import uuid
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, DateTime, func
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
