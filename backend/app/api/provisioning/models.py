from datetime import date
from typing import Optional
from uuid import UUID

from pydantic import Field, field_validator

from app.api.device.device_type.models import DeviceTypeRead
from app.api.device.models import DeviceStatus
from app.api.sensor_catalog.schemas import DeviceSensorCreate
from app.core.utils import CamelModel


class ProvisioningDevicePrepareRequest(CamelModel):
    model: Optional[str] = None
    batch: Optional[str] = None
    manufacture_date: Optional[date] = None
    # Optional: the device name (default: the generated serial) and the sensors
    # installed at the factory (provisioning/provision.py installs the one the
    # firmware variant reads). The type's compatibility and per-model maximum
    # apply; its minimum does not (sensors may still be added later).
    name: Optional[str] = None
    sensors: list[DeviceSensorCreate] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


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
