from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.auth.models import User
from app.api.device.device_type.constants import DEFAULT_DEVICE_TYPE_ID, DEFAULT_DEVICE_TYPE_NAME
from app.api.device.models import Device, DeviceStatus
from app.api.device.permissions import DevicePermissions
from app.api.provisioning.service import ProvisioningSerialExhaustedError
from app.core.security import create_access_token


def make_token(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


def create_provisioning_user(session: Session, permissions: list[str]) -> User:
    suffix = uuid4().hex[:8]
    user = User(
        email=f"provisioning-{suffix}@example.com",
        username=f"provisioning_{suffix}",
        password="x",
        is_verified=True,
        permissions=permissions,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_prepare_device_creates_unpaired_device(client: TestClient, session: Session):
    user = create_provisioning_user(session, [DevicePermissions.CREATE])
    response = client.post(
        "/api/provisioning/devices/prepare",
        headers={"Authorization": f"Bearer {make_token(user.id)}"},
        json={
            "model": "Guition-1",
            "batch": "2026-06-A",
            "manufactureDate": "2026-06-08",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["serial"].startswith("IOT-")
    assert payload["name"] == payload["serial"]
    assert payload["model"] == "Guition-1"
    assert payload["batch"] == "2026-06-A"
    assert payload["manufactureDate"] == "2026-06-08"
    assert payload["status"] == DeviceStatus.NEW.value
    assert payload["deviceTypeId"] == str(DEFAULT_DEVICE_TYPE_ID)
    assert payload["type"]["name"] == DEFAULT_DEVICE_TYPE_NAME

    device = session.exec(select(Device).where(Device.id == UUID(payload["id"]))).first()
    assert device is not None
    assert device.environment_id is None
    assert device.status == DeviceStatus.NEW
    assert device.device_type_id == DEFAULT_DEVICE_TYPE_ID


def test_prepare_device_rejects_missing_permission(client: TestClient, session: Session):
    user = create_provisioning_user(session, [])
    response = client.post(
        "/api/provisioning/devices/prepare",
        headers={"Authorization": f"Bearer {make_token(user.id)}"},
        json={},
    )

    assert response.status_code == 403


def test_prepare_device_ignores_operator_selected_device_type(
    client: TestClient,
    session: Session,
):
    user = create_provisioning_user(session, [DevicePermissions.CREATE])

    response = client.post(
        "/api/provisioning/devices/prepare",
        headers={"Authorization": f"Bearer {make_token(user.id)}"},
        json={"deviceTypeId": str(uuid4())},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["deviceTypeId"] == str(DEFAULT_DEVICE_TYPE_ID)
    assert payload["type"]["name"] == DEFAULT_DEVICE_TYPE_NAME


def test_prepare_device_maps_serial_exhaustion_to_503(
    client: TestClient,
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
):
    user = create_provisioning_user(session, [DevicePermissions.CREATE])

    class StubProvisioningService:
        async def prepare_device(self, payload):
            raise ProvisioningSerialExhaustedError(
                "Unable to generate a unique device serial"
            )

    monkeypatch.setattr(
        "app.api.provisioning.router.get_provisioning_service",
        lambda session: StubProvisioningService(),
    )

    response = client.post(
        "/api/provisioning/devices/prepare",
        headers={"Authorization": f"Bearer {make_token(user.id)}"},
        json={},
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Unable to generate a unique device serial"
    }



def _ambient_sensor(session: Session, make_ambient, code: str):
    from app.api.sensor_catalog.models import Sensor

    model = Sensor(code=code, name=code.upper(), manufacturer="Test")
    session.add(model)
    session.commit()
    make_ambient(model)
    return model.id


def test_prepare_device_accepts_name_and_sensors(
    client: TestClient, session: Session, make_ambient
):
    from app.api.sensor_catalog.models import DeviceSensor
    from app.api.sensor_catalog.permissions import SensorCatalogPermissions

    user = create_provisioning_user(
        session, [DevicePermissions.CREATE, SensorCatalogPermissions.DEVICE_WRITE]
    )
    dht22 = _ambient_sensor(session, make_ambient, "dht22")
    response = client.post(
        "/api/provisioning/devices/prepare",
        headers={"Authorization": f"Bearer {make_token(user.id)}"},
        json={"name": " Demo DHT22 ", "sensors": [{"sensorId": str(dht22), "key": "dht22"}]},
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["name"] == "Demo DHT22"
    rows = session.exec(
        select(DeviceSensor).where(DeviceSensor.device_id == UUID(payload["id"]))
    ).all()
    assert [(row.sensor_id, row.key, row.is_active) for row in rows] == [(dht22, "dht22", True)]
    device = session.exec(select(Device).where(Device.id == UUID(payload["id"]))).first()
    assert device.environment_id is None


def test_prepare_device_sensors_require_sensor_write(
    client: TestClient, session: Session, make_ambient
):
    user = create_provisioning_user(session, [DevicePermissions.CREATE])
    dht11 = _ambient_sensor(session, make_ambient, "dht11")
    devices_before = len(session.exec(select(Device)).all())
    response = client.post(
        "/api/provisioning/devices/prepare",
        headers={"Authorization": f"Bearer {make_token(user.id)}"},
        json={"sensors": [{"sensorId": str(dht11)}]},
    )

    assert response.status_code == 403
    assert len(session.exec(select(Device)).all()) == devices_before


def test_prepare_device_rejects_unknown_sensor(client: TestClient, session: Session):
    from app.api.sensor_catalog.permissions import SensorCatalogPermissions

    user = create_provisioning_user(
        session, [DevicePermissions.CREATE, SensorCatalogPermissions.DEVICE_WRITE]
    )
    response = client.post(
        "/api/provisioning/devices/prepare",
        headers={"Authorization": f"Bearer {make_token(user.id)}"},
        json={"sensors": [{"sensorId": str(uuid4())}]},
    )

    assert response.status_code == 422


def test_prepare_device_rejects_blank_name(client: TestClient, session: Session):
    user = create_provisioning_user(session, [DevicePermissions.CREATE])
    response = client.post(
        "/api/provisioning/devices/prepare",
        headers={"Authorization": f"Bearer {make_token(user.id)}"},
        json={"name": "   "},
    )

    assert response.status_code == 422
