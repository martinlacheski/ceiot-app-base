from typing import Callable, Optional

from sqlalchemy.exc import IntegrityError

from app.api.device.models import DeviceCreate
from app.api.device.repository import DeviceRepository
from app.api.device.service import DeviceService
from app.api.provisioning.models import ProvisioningDevicePrepareRequest


class ProvisioningSerialExhaustedError(RuntimeError):
    pass


class ProvisioningService:
    def __init__(
        self,
        device_repository: DeviceRepository,
        serial_generator: Optional[Callable[[], str]] = None,
        max_attempts: int = 10,
    ):
        self.device_repository = device_repository
        self.serial_generator = serial_generator or DeviceService.generate_serial
        self.max_attempts = max_attempts

    async def prepare_device(self, payload: ProvisioningDevicePrepareRequest):
        for _ in range(self.max_attempts):
            serial = DeviceService.normalize_serial(self.serial_generator())
            existing_device = await self.device_repository.get_by_serial(serial)
            if existing_device:
                continue

            try:
                return await self.device_repository.create_with_data(
                    DeviceCreate(
                        serial=serial,
                        name=serial,
                        model=payload.model,
                        batch=payload.batch,
                        manufacture_date=payload.manufacture_date,
                    )
                )
            except IntegrityError as exc:
                await self.device_repository.rollback()
                if self._is_serial_unique_conflict(exc):
                    continue
                raise

        raise ProvisioningSerialExhaustedError(
            "Unable to generate a unique device serial"
        )

    @staticmethod
    def _is_serial_unique_conflict(exc: IntegrityError) -> bool:
        message = str(exc.orig or exc).lower()
        return "serial" in message and (
            "unique" in message or "duplicate key" in message
        )
