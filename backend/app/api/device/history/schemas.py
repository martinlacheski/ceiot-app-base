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


class HistoryOperation(CamelModel):
    id: uuid.UUID
    time: datetime
    device_serial: str | None = None
    operation_type: str
    status: str


class HistoryOperationsResponse(Page):
    items: list[HistoryOperation]
