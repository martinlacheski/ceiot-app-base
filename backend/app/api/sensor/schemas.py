import uuid
from datetime import datetime
from typing import Any

from app.core.utils import CamelModel


class SensorReadingRead(CamelModel):
    id: uuid.UUID
    time: datetime
    device_id: uuid.UUID | None = None
    device_serial: str
    device_type: str
    power_supply_state: bool | None = None
    temperature_c: float | None = None
    relative_humidity_pct: float | None = None
    pressure_hpa: float | None = None
    uptime: int | None = None
    firmware_version: str | None = None
    reset_reason: str | None = None
    heap_free: int | None = None
    wifi_rssi: int | None = None
    wifi_ssid: str | None = None
    wifi_ip: str | None = None
    last_error: str | None = None
    extra_data: dict[str, Any] | None = None
    device_datetime: str | None = None


class SensorReadingListResponse(CamelModel):
    items: list[SensorReadingRead]
    total: int
