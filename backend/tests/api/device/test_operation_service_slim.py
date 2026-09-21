import uuid
from inspect import signature

import pytest
from sqlmodel import Session

from app.api.device.models import Device, DeviceStatus
from app.api.device.operations.models import (
    DeviceOperation,
    DeviceOperationStatus,
    DeviceOperationType,
)
from app.api.device.operations.service import DeviceOperationService


@pytest.mark.asyncio
async def test_device_operations_resolve_route_device_id_to_serial_and_return_slim_fields(
    session: Session,
    async_session,
):
    device = Device(
        id=uuid.uuid4(),
        serial="IOT-1000",
        name="Slim Device",
        status=DeviceStatus.PAIRED,
        is_active=True,
    )
    session.add(device)
    session.add(
        DeviceOperation(
            device_serial="IOT-1000",
            operation_type=DeviceOperationType.SENSOR_DATA,
            status=DeviceOperationStatus.SUCCESS,
        )
    )
    session.add(
        DeviceOperation(
            device_serial="IOT-2000",
            operation_type=DeviceOperationType.SENSOR_DATA,
            status=DeviceOperationStatus.SUCCESS,
        )
    )
    session.commit()

    result = await DeviceOperationService(async_session).get_by_device(
        device_id=device.id,
        page=1,
        per_page=20,
    )

    assert result["total"] == 1
    assert result["items"][0]["device_serial"] == "IOT-1000"
    assert result["items"][0]["operation_type"] == DeviceOperationType.SENSOR_DATA
    assert result["items"][0]["status"] == DeviceOperationStatus.SUCCESS
    assert "merchant_order_id" not in result["items"][0]
    assert "device_id" not in result["items"][0]
    assert "payload" not in result["items"][0]
    assert "response" not in result["items"][0]


@pytest.mark.asyncio
async def test_create_operation_has_only_generic_runtime_contract(
    session: Session,
    async_session,
):
    device_id = uuid.uuid4()

    operation = await DeviceOperationService(async_session).create_operation(
        operation_type=DeviceOperationType.KEEP_ACTIVE,
        device_id=device_id,
        device_serial="IOT-KEEP-ACTIVE",
        payload={"raw": "payload"},
        response={"raw": "response"},
        status=DeviceOperationStatus.SUCCESS,
    )

    assert operation.device_serial == "IOT-KEEP-ACTIVE"
    assert operation.operation_type == DeviceOperationType.KEEP_ACTIVE
    assert operation.status == DeviceOperationStatus.SUCCESS
    assert "merchant_order_id" not in signature(
        DeviceOperationService.create_operation
    ).parameters
    assert not hasattr(operation, "merchant_order_id")
    assert not hasattr(operation, "device_id")
    assert not hasattr(operation, "payload")
    assert not hasattr(operation, "response")
