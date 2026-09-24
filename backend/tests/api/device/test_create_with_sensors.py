"""Atomic device creation with installed sensors."""

import uuid

import pytest
from sqlmodel import select

from app.api.auth.models import User
from app.api.device.device_type.constants import DEFAULT_DEVICE_TYPE_ID
from app.api.device.device_type.models import DeviceTypeCatalog
from app.api.device.models import Device
from app.api.device.models import DeviceCreate
from app.api.device.permissions import DevicePermissions
from app.api.device.repository import DeviceRepository
from app.api.sensor_catalog.models import DeviceSensor, Sensor
from app.core.security import create_access_token


def test_create_sensors_defaults_and_ambient_rule(client, session, test_user):
    test_user.permissions = [*test_user.permissions, DevicePermissions.CREATE, "device_sensor:write"]
    session.add_all([test_user, DeviceTypeCatalog(id=DEFAULT_DEVICE_TYPE_ID, code="environmental", name="Ambiental")])
    model = Sensor(code="dht22", name="DHT22", manufacturer="Aosong")
    session.add(model)
    session.commit()
    token, _ = create_access_token({"id": str(test_user.id)})
    headers = {"Authorization": f"Bearer {token}"}
    base = {"serial": "IOT-0000-0041", "name": "Ambiental", "deviceTypeId": str(DEFAULT_DEVICE_TYPE_ID)}

    missing = client.post("/api/devices", json=base, headers=headers)
    assert missing.status_code == 422
    assert "sensor" in missing.json()["detail"].lower()

    created = client.post("/api/devices", json={**base, "sensors": [
        {"sensorId": str(model.id)}, {"sensorId": str(model.id)}]}, headers=headers)
    assert created.status_code == 200, created.text
    rows = session.exec(select(DeviceSensor).where(DeviceSensor.device_id == uuid.UUID(created.json()["id"]))).all()
    assert {row.key for row in rows} == {"dht22", "dht22_2"}


def test_invalid_sensor_and_duplicate_key_do_not_create_device(client, session, test_user):
    test_user.permissions = [*test_user.permissions, DevicePermissions.CREATE, "device_sensor:write"]
    session.add_all([test_user, DeviceTypeCatalog(id=DEFAULT_DEVICE_TYPE_ID, code="environmental", name="Ambiental")])
    model = Sensor(code="dht22", name="DHT22", manufacturer="Aosong")
    inactive = Sensor(code="old", name="Old", manufacturer="Aosong", is_active=False)
    session.add_all([model, inactive])
    session.commit()
    token, _ = create_access_token({"id": str(test_user.id)})
    headers = {"Authorization": f"Bearer {token}"}
    for serial, sensors in [
        ("IOT-0000-0042", [{"sensorId": str(model.id)}, {"sensorId": str(uuid.uuid4())}]),
        ("IOT-0000-0043", [{"sensorId": str(inactive.id)}]),
        ("IOT-0000-0044", [{"sensorId": str(model.id), "key": "same"}, {"sensorId": str(model.id), "key": "same"}]),
    ]:
        result = client.post("/api/devices", json={"serial": serial, "name": "Invalid", "sensors": sensors}, headers=headers)
        assert result.status_code == 422, result.text
        assert session.exec(select(Device).where(Device.serial == serial)).first() is None


@pytest.mark.asyncio
async def test_repository_allows_sensorless_devices_of_any_type(session, async_session):
    """The Ambiental-needs-a-sensor rule is a POST /api/devices policy, not a
    repository invariant: internal creation paths (provisioning, pairing,
    etc.) go through DeviceRepository.create_with_data directly and must be
    able to create a sensorless device of *any* type, including Ambiental --
    sensors get attached later. See test_create_sensors_defaults_and_ambient_rule
    above for the router-level 422, and test_provisioning_creates_sensorless_device
    below for the real internal caller.
    """
    other = DeviceTypeCatalog(code="other_test", name="Other test")
    session.add_all([DeviceTypeCatalog(id=DEFAULT_DEVICE_TYPE_ID, code="environmental", name="Ambiental"), other])
    session.commit()
    repo = DeviceRepository(async_session)
    ambient = await repo.create_with_data(DeviceCreate(serial="IOT-0000-0045", name="Ambiental"))
    assert ambient.serial == "IOT-0000-0045"
    assert ambient.device_type_id == DEFAULT_DEVICE_TYPE_ID
    created = await repo.create_with_data(DeviceCreate(serial="IOT-0000-0046", name="Other", deviceTypeId=other.id))
    assert created.serial == "IOT-0000-0046"


@pytest.mark.asyncio
async def test_provisioning_creates_sensorless_device(session, async_session):
    """ProvisioningService (used by POST /api/provisioning/devices/prepare)
    resolves to the default (Ambiental) device type and never sends sensors:
    it must keep working now that the sensor rule moved out of the repository.
    """
    from app.api.provisioning.models import ProvisioningDevicePrepareRequest
    from app.api.provisioning.service import ProvisioningService

    session.add(DeviceTypeCatalog(id=DEFAULT_DEVICE_TYPE_ID, code="environmental", name="Ambiental"))
    session.commit()
    repo = DeviceRepository(async_session)
    provisioning = ProvisioningService(repo, serial_generator=lambda: "IOT-0000-0047")

    device = await provisioning.prepare_device(ProvisioningDevicePrepareRequest())

    assert device.serial == "IOT-0000-0047"
    assert device.device_type_id == DEFAULT_DEVICE_TYPE_ID
    rows = (await async_session.exec(select(DeviceSensor).where(DeviceSensor.device_id == device.id))).all()
    assert rows == []
