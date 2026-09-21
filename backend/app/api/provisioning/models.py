from datetime import date
from typing import Optional
from uuid import UUID

from app.api.device.device_type.models import DeviceTypeRead
from app.api.device.models import DeviceStatus
from app.core.utils import CamelModel


class ProvisioningDevicePrepareRequest(CamelModel):
    model: Optional[str] = None
    batch: Optional[str] = None
    manufacture_date: Optional[date] = None


class ProvisioningDevicePrepareResponse(CamelModel):
    id: UUID
    serial: str
    name: str
    device_type_id: UUID
    type: Optional[DeviceTypeRead] = None
    model: Optional[str] = None
    batch: Optional[str] = None
    manufacture_date: Optional[date] = None
    status: DeviceStatus
