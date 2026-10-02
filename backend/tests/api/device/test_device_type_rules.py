"""Data-driven sensor rules: minimum, compatibility, per-model maximum and required kit."""

import uuid

import pytest
from sqlmodel import select

from app.api.auth.models import User
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.api.device.device_type.constants import DEFAULT_DEVICE_TYPE_ID
from app.api.device.device_type.models import DeviceTypeCatalog, DeviceTypeSensor
from app.api.device.models import Device
from app.api.device.permissions import DevicePermissions
from app.api.device.repository import DeviceRepository
from app.api.device.models import DeviceCreate
from app.api.sensor_catalog.models import DeviceSensor, Sensor
from app.core.security import create_access_token


@pytest.fixture(name="admin")
def admin_fixture(session, admin_user):
    admin_user.permissions = [
        DevicePermissions.READ, DevicePermissions.READ_ALL, DevicePermissions.CREATE,
        DevicePermissions.UPDATE, "device_sensor:write", "device_sensor:read",
    ]
    session.add(admin_user)
    session.commit()
    token, _ = create_access_token({"id": str(admin_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(name="sensors")
def sensors_fixture(session):
    rows = {code: Sensor(code=code, name=code.upper(), manufacturer="X") for code in ("dht22", "bme280", "bmp280")}
    session.add_all(rows.values())
    session.commit()
    return rows


def new_device(client, admin, serial, sensor_ids=(), type_id=DEFAULT_DEVICE_TYPE_ID):
    return client.post("/api/devices", headers=admin, json={
        "serial": serial, "name": "Dispositivo", "deviceTypeId": str(type_id),
        "sensors": [{"sensorId": str(sensor_id)} for sensor_id in sensor_ids],
    })


def test_minimum_sensors_comes_from_the_type(client, session, admin, sensors, make_ambient):
    make_ambient(sensors["dht22"], sensors["bme280"], min_sensors=2)
    one = new_device(client, admin, "IOT-0000-0101", [sensors["dht22"].id])
    assert one.status_code == 422 and "2" in one.json()["detail"]
    none = new_device(client, admin, "IOT-0000-0102")
    assert none.status_code == 422
    two = new_device(client, admin, "IOT-0000-0103", [sensors["dht22"].id, sensors["bme280"].id])
    assert two.status_code == 200, two.text


def test_zero_minimum_allows_sensorless_registration_of_the_default_type(client, session, admin, sensors, make_ambient):
    make_ambient(sensors["dht22"], min_sensors=0)
    created = new_device(client, admin, "IOT-0000-0104")
    assert created.status_code == 200, created.text


def test_incompatible_model_is_rejected_and_nothing_is_created(client, session, admin, sensors, make_ambient):
    make_ambient(sensors["dht22"], sensors["bme280"])
    response = new_device(client, admin, "IOT-0000-0105", [sensors["dht22"].id, sensors["bmp280"].id])
    assert response.status_code == 422
    assert "BMP280" in response.json()["detail"]
    assert session.exec(select(Device).where(Device.serial == "IOT-0000-0105")).first() is None


def test_max_count_per_model_is_enforced(client, session, admin, sensors, make_ambient):
    make_ambient(sensors["dht22"], sensors["bme280"], max_count=2)
    over = new_device(client, admin, "IOT-0000-0106", [sensors["dht22"].id] * 3)
    assert over.status_code == 422 and "DHT22" in over.json()["detail"]
    ok = new_device(client, admin, "IOT-0000-0107", [sensors["dht22"].id] * 2)
    assert ok.status_code == 200, ok.text


def test_required_sensor_must_be_present(client, session, admin, sensors, make_ambient):
    ambient = make_ambient(sensors["dht22"], sensors["bme280"], min_sensors=0)
    link = session.get(DeviceTypeSensor, (ambient.id, sensors["bme280"].id))
    link.required = True
    session.add(link)
    session.commit()
    missing = new_device(client, admin, "IOT-0000-0108", [sensors["dht22"].id])
    assert missing.status_code == 422 and "BME280" in missing.json()["detail"]
    assert new_device(client, admin, "IOT-0000-0109", [sensors["bme280"].id]).status_code == 200


def test_type_without_compatible_sensors_accepts_none(client, session, admin, sensors):
    relay = DeviceTypeCatalog(code="relay_board", name="Placa de relés")
    session.add(relay)
    session.commit()
    assert new_device(client, admin, "IOT-0000-0110", type_id=relay.id).status_code == 200
    rejected = new_device(client, admin, "IOT-0000-0111", [sensors["dht22"].id], type_id=relay.id)
    assert rejected.status_code == 422


@pytest.mark.asyncio
async def test_repository_without_sensors_is_exempt_from_the_minimum(session, async_session, sensors, make_ambient):
    """Provisioning and pairing create sensorless devices of any type; only the manual endpoint enforces min_sensors."""
    make_ambient(sensors["dht22"], min_sensors=3)
    device = await DeviceRepository(async_session).create_with_data(DeviceCreate(serial="IOT-0000-0112", name="Provisioned"))
    assert device.device_type_id == DEFAULT_DEVICE_TYPE_ID


def _device_with_sensor(session, sensor, serial, count=1):
    """A paired device (the sensor/access endpoints need an environment with an owner)."""
    country = LocationCountry(name=f"Pais {serial}")
    session.add(country)
    session.commit()
    state = LocationState(name=f"Prov {serial}", country_id=country.id)
    session.add(state)
    session.commit()
    city = LocationCity(name=f"Ciudad {serial}", postal_code="5000", state_id=state.id)
    env_type = EnvironmentType(name=f"Tipo {serial}")
    session.add_all([city, env_type])
    session.commit()
    environment = Environment(name=f"Env {serial}", address="Calle 1", location="Sala", description="d",
                              city_id=city.id, type_id=env_type.id)
    owner = User(email=f"{serial}@example.com", username=f"owner{serial}", password="x", permissions=[])
    session.add_all([environment, owner])
    session.commit()
    session.add(EnvironmentUser(environment_id=environment.id, user_id=owner.id, is_owner=True, is_active=True))
    device = Device(serial=serial, name="Existente", device_type_id=DEFAULT_DEVICE_TYPE_ID,
                    environment_id=environment.id)
    session.add(device)
    session.commit()
    for index in range(count):
        session.add(DeviceSensor(device_id=device.id, sensor_id=sensor.id, key=f"{sensor.code}_{index}"))
    session.commit()
    return device


def test_add_sensor_later_enforces_compatibility_and_max_count(client, session, admin, sensors, make_ambient):
    make_ambient(sensors["dht22"], max_count=2)
    device = _device_with_sensor(session, sensors["dht22"], "IOT-0000-0113")
    url = f"/api/devices/{device.id}/sensors"
    incompatible = client.post(url, json={"sensorId": str(sensors["bmp280"].id)}, headers=admin)
    assert incompatible.status_code == 422 and "BMP280" in incompatible.json()["detail"]
    second = client.post(url, json={"sensorId": str(sensors["dht22"].id)}, headers=admin)
    assert second.status_code == 201, second.text
    third = client.post(url, json={"sensorId": str(sensors["dht22"].id)}, headers=admin)
    assert third.status_code == 422 and "DHT22" in third.json()["detail"]
    # A deactivated installation no longer counts against the maximum.
    client.delete(f"{url}/{second.json()['id']}", headers=admin)
    assert client.post(url, json={"sensorId": str(sensors["dht22"].id)}, headers=admin).status_code == 201


def test_changing_type_with_incompatible_installed_sensors_is_rejected(client, session, admin, sensors, make_ambient):
    make_ambient(sensors["dht22"])
    device = _device_with_sensor(session, sensors["dht22"], "IOT-0000-0114")
    relay = DeviceTypeCatalog(code="relay_board", name="Placa de relés")
    compatible = DeviceTypeCatalog(code="dht_only", name="Solo DHT")
    session.add_all([relay, compatible])
    session.commit()
    session.add(DeviceTypeSensor(device_type_id=compatible.id, sensor_id=sensors["dht22"].id, max_count=1))
    session.commit()

    rejected = client.put(f"/api/devices/{device.id}", json={"deviceTypeId": str(relay.id)}, headers=admin)
    assert rejected.status_code == 422 and "DHT22" in rejected.json()["detail"]
    session.expire_all()
    assert session.get(Device, device.id).device_type_id == DEFAULT_DEVICE_TYPE_ID
    assert session.exec(select(DeviceSensor).where(DeviceSensor.device_id == device.id)).all()

    accepted = client.put(f"/api/devices/{device.id}", json={"deviceTypeId": str(compatible.id)}, headers=admin)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["deviceTypeId"] == str(compatible.id)
    assert uuid.UUID(accepted.json()["id"]) == device.id
