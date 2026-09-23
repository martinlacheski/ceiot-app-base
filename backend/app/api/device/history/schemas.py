"""Public device-history projections; intentionally exclude free-form payloads."""

import uuid
from datetime import datetime

from app.core.utils import CamelModel


class Page(CamelModel):
    total: int
    page: int
    per_page: int
    pages: int


class HistoryDeviceItem(CamelModel):
    serial: str
    device_name: str | None = None
    environment_id: uuid.UUID
    environment_name: str | None = None
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    readings_count: int = 0
    operations_count: int = 0
    is_former: bool
    owner_id: uuid.UUID | None = None
    owner_name: str | None = None


class HistoryDevicesResponse(Page):
    items: list[HistoryDeviceItem]


class HistorySensorReading(CamelModel):
    id: uuid.UUID
    time: datetime
    device_serial: str
    device_type: str | None = None
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
    device_datetime: str | None = None


class HistorySensorReadingsResponse(Page):
    items: list[HistorySensorReading]


class HistoryOperation(CamelModel):
    id: uuid.UUID
    time: datetime
    device_serial: str | None = None
    operation_type: str
    status: str


class HistoryOperationsResponse(Page):
    items: list[HistoryOperation]
