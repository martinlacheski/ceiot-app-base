"""S3 API contract regressions (no PostgreSQL required)."""

import uuid

from app.api.router import router
from app.api.device.models import Device
from app.api.sensor_catalog.models import Sensor, SensorVariable, Variable
from app.core.security import create_access_token


def test_s3_routes_are_registered():
    paths = {route.path for route in router.routes}
    assert "/sensor-catalog/variables" in paths
    assert "/sensor-catalog/sensors" in paths
    assert "/devices/{device_id}/sensors" in paths
    assert "/devices/{device_id}/sensors/{id}" in paths
    assert "/devices/{device_id}/telemetry/latest" in paths
    assert "/devices/{device_id}/telemetry/history" in paths
    assert "/devices/history/devices/{serial}/telemetry" in paths


def test_sensor_key_validation_and_camel_case():
    from pydantic import ValidationError
    from app.api.sensor_catalog.schemas import DeviceSensorCreate, DeviceSensorRead

    assert DeviceSensorCreate(sensorId=uuid.uuid4(), key="dht22_2").key == "dht22_2"
    for bad in ("DHT22", "_dht22", "dht22__2", "dht22_", "dht-22"):
        try:
            DeviceSensorCreate(sensorId=uuid.uuid4(), key=bad)
        except ValidationError:
            pass
        else:
            raise AssertionError(f"accepted invalid key {bad}")
    row = DeviceSensorRead(id=uuid.uuid4(), device_id=uuid.uuid4(), sensor_id=uuid.uuid4(),
                           key="dht22", config={}, is_active=True)
    assert "sensorId" in row.model_dump(by_alias=True)


def _headers(user):
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


def test_catalog_requires_auth_and_returns_variable_metadata(client, session, test_user):
    variable = Variable(code="temperature", name="Temperature", unit="°C")
    sensor = Sensor(code="dht22", name="DHT22", manufacturer="Aosong")
    session.add_all([variable, sensor])
    session.commit()
    session.add(SensorVariable(sensor_id=sensor.id, variable_id=variable.id,
        min_value=-40, max_value=80, accuracy="±0.5 °C", resolution="0.1 °C"))
    test_user.permissions = [*test_user.permissions, "sensor_catalog:read"]
    session.add(test_user)
    session.commit()
    assert client.get("/api/sensor-catalog/variables").status_code == 401
    variables = client.get("/api/sensor-catalog/variables", headers=_headers(test_user))
    assert variables.status_code == 200
    assert variables.json()[0]["code"] == "temperature"
    sensors = client.get("/api/sensor-catalog/sensors", headers=_headers(test_user))
    assert sensors.status_code == 200
    assert sensors.json()[0]["variables"] == [{"code": "temperature", "name": "Temperature",
        "unit": "°C", "min": -40.0, "max": 80.0, "accuracy": "±0.5 °C", "resolution": "0.1 °C"}]


def test_telemetry_pagination_cap_and_history_filter_validation(client, session, test_user):
    test_user.permissions = [*test_user.permissions, "telemetry:read"]
    session.add(test_user)
    session.commit()
    device_id = uuid.uuid4()
    response = client.get(f"/api/devices/{device_id}/telemetry/history",
        params={"start": "2026-01-01T00:00:00Z", "end": "2026-01-02T00:00:00Z",
                "per_page": 10001}, headers=_headers(test_user))
    assert response.status_code == 422
    response = client.get("/api/devices/history/devices/IOT-0000-0000/telemetry",
        params={"min": 10}, headers=_headers(test_user))
    assert response.status_code == 422
    response = client.get("/api/devices/history/devices/IOT-0000-0000/telemetry",
        params={"per_page": 10001}, headers=_headers(test_user))
    assert response.status_code == 422


def test_device_sensor_default_duplicate_and_deactivation(client, session, test_user, monkeypatch):
    from datetime import datetime, timezone
    from app.api.sensor.models import Telemetry
    from app.api.sensor_catalog import router as module

    async def allow(*args, **kwargs):
        return None

    monkeypatch.setattr(module, "_authorize", allow)
    monkeypatch.setattr(module, "_resolve_access_start", allow)
    test_user.permissions = [*test_user.permissions, "device_sensor:read", "device_sensor:write",
                             "telemetry:read"]
    sensor = Sensor(code="dht22", name="DHT22", manufacturer="Aosong")
    variable = Variable(code="temperature", name="Temperature", unit="°C")
    device = Device(serial="IOT-0000-0031", name="Test sensor device")
    session.add_all([test_user, sensor, variable, device])
    session.commit()
    session.add(SensorVariable(sensor_id=sensor.id, variable_id=variable.id,
        min_value=-40, max_value=80, accuracy="±0.5 °C", resolution="0.1 °C"))
    session.commit()
    device_id = device.id
    endpoint = f"/api/devices/{device_id}/sensors"
    first = client.post(endpoint, json={"sensorId": str(sensor.id)}, headers=_headers(test_user))
    assert first.status_code == 201, first.text
    assert first.json()["key"] == "dht22"
    second = client.post(endpoint, json={"sensorId": str(sensor.id)}, headers=_headers(test_user))
    assert second.status_code == 201, second.text
    assert second.json()["key"] == "dht22_2"
    duplicate = client.post(endpoint, json={"sensorId": str(sensor.id), "key": "dht22"},
                            headers=_headers(test_user))
    assert duplicate.status_code == 409
    invalid = client.post(endpoint, json={"sensorId": str(sensor.id), "key": "DHT22"},
                          headers=_headers(test_user))
    assert invalid.status_code == 422
    assert client.post(endpoint, json={"sensorId": str(uuid.uuid4())},
                       headers=_headers(test_user)).status_code == 404
    assert client.patch(f"{endpoint}/{uuid.uuid4()}", json={"key": "missing"},
                        headers=_headers(test_user)).status_code == 404
    assert client.patch(f"{endpoint}/{second.json()['id']}", json={"key": "dht22"},
                        headers=_headers(test_user)).status_code == 409
    session.add(Telemetry(time=datetime(2026, 1, 1, tzinfo=timezone.utc),
        device_id=device_id, device_serial=device.serial,
        values={"dht22": {"temperature": 23.4}, "dht22_2": {"temperature": 24.1}}))
    session.commit()
    patched = client.patch(f"{endpoint}/{second.json()['id']}",
        json={"key": "indoor", "config": {"pin": 4}, "isActive": False},
        headers=_headers(test_user))
    assert patched.status_code == 200
    assert patched.json()["key"] == "indoor"
    assert patched.json()["config"] == {"pin": 4}
    assert patched.json()["isActive"] is False
    deleted = client.delete(f"{endpoint}/{first.json()['id']}", headers=_headers(test_user))
    assert deleted.status_code == 200
    assert deleted.json()["isActive"] is False
    assert deleted.json()["removedAt"] is not None
    listed = client.get(endpoint, headers=_headers(test_user))
    assert listed.status_code == 200
    assert len(listed.json()) == 3
    assert listed.json()[0]["id"] == first.json()["id"]
    assert any(item["key"] == "dht22_2" and not item["isActive"] for item in listed.json())
    retained = client.get(f"/api/devices/{device_id}/telemetry/latest",
                          headers=_headers(test_user))
    assert retained.status_code == 200
    assert retained.json()["items"][0]["values"] == {
        "dht22": {"temperature": 23.4}, "dht22_2": {"temperature": 24.1}}
    assert {item["key"] for item in retained.json()["sensors"]} == {"dht22", "dht22_2"}


def test_device_access_errors_are_preserved(client, session, test_user, monkeypatch):
    from fastapi import HTTPException
    from app.api.sensor_catalog import router as module

    test_user.permissions = [*test_user.permissions, "device_sensor:read", "telemetry:read"]
    session.add(test_user)
    session.commit()

    async def denied(*args, **kwargs):
        raise HTTPException(403, "No device access")

    monkeypatch.setattr(module, "_resolve_access_start", denied)
    device_id = uuid.uuid4()
    assert client.get(f"/api/devices/{device_id}/sensors",
                      headers=_headers(test_user)).status_code == 403
    assert client.get(f"/api/devices/{device_id}/telemetry/latest",
                      headers=_headers(test_user)).status_code == 403

    async def missing(*args, **kwargs):
        raise HTTPException(404, "Device not found")

    monkeypatch.setattr(module, "_resolve_access_start", missing)
    assert client.get(f"/api/devices/{device_id}/telemetry/latest",
                      headers=_headers(test_user)).status_code == 404


def test_latest_and_history_return_json_values_and_sensor_labels(
    client, session, test_user, monkeypatch
):
    from datetime import datetime, timezone
    from app.api.sensor.models import Telemetry
    from app.api.sensor_catalog.models import DeviceSensor
    from app.api.sensor_catalog import router as module

    async def allow(*args, **kwargs):
        return None

    monkeypatch.setattr(module, "_resolve_access_start", allow)
    test_user.permissions = [*test_user.permissions, "telemetry:read"]
    variable = Variable(code="temperature", name="Temperature", unit="°C")
    sensor = Sensor(code="dht22", name="DHT22", manufacturer="Aosong")
    device = Device(serial="IOT-0000-0032", name="Test telemetry device")
    session.add_all([test_user, variable, sensor, device])
    session.commit()
    device_id = device.id
    session.add_all([
        SensorVariable(sensor_id=sensor.id, variable_id=variable.id,
                       min_value=-40, max_value=80, accuracy="±0.5 °C", resolution="0.1 °C"),
        DeviceSensor(device_id=device_id, sensor_id=sensor.id, key="dht22", config={}),
        Telemetry(time=datetime(2026, 1, 1, tzinfo=timezone.utc), device_id=device_id,
                  device_serial=device.serial, values={"dht22": {"temperature": 23.4}}),
    ])
    session.commit()
    endpoint = f"/api/devices/{device_id}/telemetry"
    latest = client.get(f"{endpoint}/latest", headers=_headers(test_user))
    assert latest.status_code == 200, latest.text
    assert latest.json()["items"][0]["values"] == {"dht22": {"temperature": 23.4}}
    assert latest.json()["sensors"] == [{"key": "dht22", "sensorCode": "dht22",
        "sensorName": "DHT22", "variables": [{"code": "temperature", "name": "Temperature",
        "unit": "°C"}]}]
    history = client.get(f"{endpoint}/history", params={
        "start": "2025-12-31T00:00:00Z", "end": "2026-01-02T00:00:00Z"},
        headers=_headers(test_user))
    assert history.status_code == 200, history.text
    assert history.json()["total"] == 1
    assert history.json()["perPage"] == 100


def test_real_context_owner_guest_outsider_and_serial_history(
    client, session, test_user, async_engine, monkeypatch
):
    from contextlib import asynccontextmanager
    from datetime import datetime, timezone
    from sqlmodel.ext.asyncio.session import AsyncSession

    from app.api.device.history import router as history_module
    from app.api.sensor.models import Telemetry
    from app.api.sensor_catalog.models import DeviceSensor
    from sensor_graph import seed_sensor_graph

    seed = seed_sensor_graph(session)
    device = seed["device"]
    device.serial = "IOT-0000-0041"
    for key in ("owner", "guest", "future_guest", "outsider"):
        user = seed[key]
        user.permissions = [*user.permissions, "device_sensor:read", "device_sensor:write",
                            "telemetry:read"]
        session.add(user)
    session.add(device)
    sensor = Sensor(code="dht22", name="DHT22", manufacturer="Aosong")
    variable = Variable(code="temperature", name="Temperature", unit="°C")
    session.add_all([sensor, variable])
    session.commit()
    session.add_all([
        SensorVariable(sensor_id=sensor.id, variable_id=variable.id,
                       min_value=-40, max_value=80, accuracy="±0.5 °C", resolution="0.1 °C"),
        DeviceSensor(device_id=device.id, sensor_id=sensor.id, key="dht22", config={}),
        Telemetry(time=datetime(2026, 1, 1, tzinfo=timezone.utc), device_id=device.id,
                  device_serial=device.serial, environment_id=device.environment_id,
                  values={"dht22": {"temperature": 23.4}}),
    ])
    session.commit()

    @asynccontextmanager
    async def metadata_session():
        async with AsyncSession(async_engine) as async_session:
            yield async_session

    monkeypatch.setattr(history_module, "system_session", metadata_session)
    endpoint = f"/api/devices/{device.id}"
    assert client.get(f"{endpoint}/sensors", headers=_headers(seed["owner"])).status_code == 200
    assert client.get(f"{endpoint}/sensors", headers=_headers(seed["guest"])).status_code == 200
    assert client.post(f"{endpoint}/sensors", json={"sensorId": str(sensor.id)},
                       headers=_headers(seed["guest"])).status_code == 403
    assert client.get(f"{endpoint}/sensors", headers=_headers(seed["future_guest"])).status_code == 403
    assert client.get(f"{endpoint}/telemetry/latest", headers=_headers(seed["outsider"])).status_code in (403, 404)
    assert client.get(f"{endpoint}/telemetry/latest", headers=_headers(seed["owner"])).status_code == 200
    history_path = f"/api/devices/history/devices/{device.serial}/telemetry"
    history = client.get(history_path, headers=_headers(seed["owner"]))
    assert history.status_code == 200, history.text
    assert history.json()["items"][0]["values"]["dht22"]["temperature"] == 23.4
    assert history.json()["sensors"][0]["sensorCode"] == "dht22"
    assert client.get(history_path, headers=_headers(seed["guest"])).status_code == 404
