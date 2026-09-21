from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.api.provisioning.models import ProvisioningDevicePrepareRequest
from app.api.provisioning.service import (
    ProvisioningSerialExhaustedError,
    ProvisioningService,
)


class StubDeviceRepository:
    def __init__(
        self,
        existing_by_serial=None,
        created_device=None,
        create_side_effects=None,
    ):
        self.existing_by_serial = existing_by_serial or {}
        self.created_device = created_device
        self.create_side_effects = list(create_side_effects or [])
        self.checked_serials = []
        self.created_payloads = []
        self.rollback_calls = 0

    async def get_by_serial(self, serial: str):
        self.checked_serials.append(serial)
        return self.existing_by_serial.get(serial)

    async def create_with_data(self, payload):
        self.created_payloads.append(payload)
        if self.create_side_effects:
            effect = self.create_side_effects.pop(0)
            if isinstance(effect, Exception):
                raise effect
            return effect
        return self.created_device

    async def rollback(self):
        self.rollback_calls += 1


@pytest.mark.asyncio
async def test_prepare_device_retries_serial_collision():
    created_device = object()
    repository = StubDeviceRepository(
        existing_by_serial={"IOT-AAAA-AAAA": object()},
        created_device=created_device,
    )
    serials = iter(["IOT-AAAA-AAAA", "IOT-BBBB-BBBB"])
    service = ProvisioningService(
        repository,
        serial_generator=lambda: next(serials),
        max_attempts=2,
    )

    result = await service.prepare_device(
        ProvisioningDevicePrepareRequest(model="G1", batch="B-01")
    )

    assert result is created_device
    assert repository.checked_serials == ["IOT-AAAA-AAAA", "IOT-BBBB-BBBB"]
    assert repository.created_payloads[0].serial == "IOT-BBBB-BBBB"
    assert repository.created_payloads[0].name == "IOT-BBBB-BBBB"
    assert repository.created_payloads[0].model == "G1"
    assert repository.created_payloads[0].batch == "B-01"


@pytest.mark.asyncio
async def test_prepare_device_retries_unique_integrity_error_and_preserves_payload():
    created_device = object()
    repository = StubDeviceRepository(
        created_device=created_device,
        create_side_effects=[
            IntegrityError(
                statement="INSERT INTO device (serial)",
                params={"serial": "IOT-AAAA-AAAA"},
                orig=Exception("UNIQUE constraint failed: device.serial"),
            ),
            created_device,
        ],
    )
    serials = iter(["IOT-AAAA-AAAA", "IOT-BBBB-BBBB"])
    service = ProvisioningService(
        repository,
        serial_generator=lambda: next(serials),
        max_attempts=2,
    )

    result = await service.prepare_device(
        ProvisioningDevicePrepareRequest(
            model="G1",
            batch="B-01",
            manufacture_date=date(2026, 6, 8),
        )
    )

    assert result is created_device
    assert repository.checked_serials == ["IOT-AAAA-AAAA", "IOT-BBBB-BBBB"]
    assert repository.rollback_calls == 1
    assert [payload.serial for payload in repository.created_payloads] == [
        "IOT-AAAA-AAAA",
        "IOT-BBBB-BBBB",
    ]
    assert repository.created_payloads[0].name == "IOT-AAAA-AAAA"
    assert repository.created_payloads[1].name == "IOT-BBBB-BBBB"
    assert repository.created_payloads[1].manufacture_date == date(2026, 6, 8)


def test_prepare_request_schema_does_not_expose_device_type_id():
    assert "device_type_id" not in ProvisioningDevicePrepareRequest.model_fields


@pytest.mark.asyncio
async def test_prepare_device_defaults_to_seeded_relay_type():
    created_device = object()
    repository = StubDeviceRepository(created_device=created_device)
    service = ProvisioningService(
        repository,
        serial_generator=lambda: "IOT-CCCC-CCCC",
        max_attempts=1,
    )

    result = await service.prepare_device(ProvisioningDevicePrepareRequest())

    assert result is created_device
    assert repository.created_payloads[0].device_type_id is None


@pytest.mark.asyncio
async def test_prepare_device_raises_after_max_attempts():
    repository = StubDeviceRepository(existing_by_serial={"IOT-AAAA-AAAA": object()})
    service = ProvisioningService(
        repository,
        serial_generator=lambda: "IOT-AAAA-AAAA",
        max_attempts=2,
    )

    with pytest.raises(
        ProvisioningSerialExhaustedError,
        match="Unable to generate a unique device serial",
    ):
        await service.prepare_device(ProvisioningDevicePrepareRequest())
