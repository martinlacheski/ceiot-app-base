"""Admin-only device emulator endpoints (E2).

Publishes synthetic telemetry / time requests for a real device through the
backend's own MQTT client so the browser never needs broker credentials or a
device certificate.
"""

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.api.device.models import Device
from app.api.sensor_catalog.models import DeviceSensor, Sensor, SensorVariable, Variable
from app.core.security import create_access_token


def make_token(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


def seed_device_with_sensor(session, *, serial="IOT-EMUL-0001", enabled=True, is_active=True):
    variable = Variable(code="temperature", name="Temperatura", unit="°C")
    session.add(variable)
    session.commit()
    session.refresh(variable)

    sensor = Sensor(code="dht22", name="DHT22", manufacturer="Aosong")
    session.add(sensor)
    session.commit()
    session.refresh(sensor)

    sensor_variable = SensorVariable(
        sensor_id=sensor.id,
        variable_id=variable.id,
        min_value=-40.0,
        max_value=80.0,
        accuracy="±0.5",
        resolution="0.1",
    )
    session.add(sensor_variable)
    session.commit()

    device = Device(serial=serial, name="Emulated device", enabled=enabled, is_active=is_active)
    session.add(device)
    session.commit()
    session.refresh(device)

    device_sensor = DeviceSensor(device_id=device.id, sensor_id=sensor.id, key="dht22")
    session.add(device_sensor)
    session.commit()

    return device


@pytest.fixture
def mock_mqtt_client(monkeypatch):
    mock_client = MagicMock()
    monkeypatch.setattr("app.api.device.emulator.router.get_mqtt_client", lambda: mock_client)
    return mock_client


def test_non_admin_gets_403(client: TestClient, session, test_user, mock_mqtt_client):
    device = seed_device_with_sensor(session)
    token = make_token(test_user.id)

    response = client.post(
        f"/api/devices/{device.id}/emulator/telemetry",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": {"dht22": {"temperature": 22.5}}},
    )

    assert response.status_code == 403
    mock_mqtt_client.publish.assert_not_called()


def test_admin_publishes_telemetry_on_the_right_topic(client: TestClient, session, admin_user, mock_mqtt_client):
    device = seed_device_with_sensor(session)
    token = make_token(admin_user.id)

    response = client.post(
        f"/api/devices/{device.id}/emulator/telemetry",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": {"dht22": {"temperature": 22.5}}, "uptime": 120},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["topic"] == f"iot/devices/{device.serial}/telemetry"
    assert body["payload"]["sensors"] == {"dht22": {"temperature": 22.5}}
    assert body["payload"]["uptime"] == 120
    assert body["payload"]["firmware_version"] == "emulador"

    mock_mqtt_client.publish.assert_called_once()
    call_args = mock_mqtt_client.publish.call_args
    assert call_args.args[0] == f"iot/devices/{device.serial}/telemetry"
    assert call_args.args[1]["sensors"] == {"dht22": {"temperature": 22.5}}
    assert call_args.kwargs["qos"] == 1


def test_telemetry_rejects_unknown_sensor_key(client: TestClient, session, admin_user, mock_mqtt_client):
    device = seed_device_with_sensor(session)
    token = make_token(admin_user.id)

    response = client.post(
        f"/api/devices/{device.id}/emulator/telemetry",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": {"unknown_sensor": {"temperature": 22.5}}},
    )

    assert response.status_code == 422
    mock_mqtt_client.publish.assert_not_called()


def test_telemetry_rejects_out_of_range_value(client: TestClient, session, admin_user, mock_mqtt_client):
    device = seed_device_with_sensor(session)
    token = make_token(admin_user.id)

    response = client.post(
        f"/api/devices/{device.id}/emulator/telemetry",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": {"dht22": {"temperature": 999}}},
    )

    assert response.status_code == 422
    mock_mqtt_client.publish.assert_not_called()


def test_telemetry_404s_for_missing_device(client: TestClient, session, admin_user, mock_mqtt_client):
    token = make_token(admin_user.id)

    response = client.post(
        f"/api/devices/{uuid.uuid4()}/emulator/telemetry",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": {"dht22": {"temperature": 22.5}}},
    )

    assert response.status_code == 404
    mock_mqtt_client.publish.assert_not_called()


def test_telemetry_422s_for_disabled_device(client: TestClient, session, admin_user, mock_mqtt_client):
    device = seed_device_with_sensor(session, serial="IOT-EMUL-0002", enabled=False)
    token = make_token(admin_user.id)

    response = client.post(
        f"/api/devices/{device.id}/emulator/telemetry",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": {"dht22": {"temperature": 22.5}}},
    )

    assert response.status_code == 422
    mock_mqtt_client.publish.assert_not_called()


def test_admin_publishes_time_request(client: TestClient, session, admin_user, mock_mqtt_client):
    device = seed_device_with_sensor(session, serial="IOT-EMUL-0003")
    token = make_token(admin_user.id)

    response = client.post(
        f"/api/devices/{device.id}/emulator/time-request",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["topic"] == f"iot/devices/{device.serial}/time/request"
    assert "reqId" in body

    mock_mqtt_client.publish.assert_called_once()
    call_args = mock_mqtt_client.publish.call_args
    assert call_args.args[0] == f"iot/devices/{device.serial}/time/request"
    assert call_args.args[1]["req_id"] == body["reqId"]


def test_non_admin_cannot_publish_time_request(client: TestClient, session, test_user, mock_mqtt_client):
    device = seed_device_with_sensor(session, serial="IOT-EMUL-0004")
    token = make_token(test_user.id)

    response = client.post(
        f"/api/devices/{device.id}/emulator/time-request",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 403
    mock_mqtt_client.publish.assert_not_called()
