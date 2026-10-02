"""Device type administration: CRUD, compatible sensors, list standard and access rules."""

import uuid

import pytest

from app.api.device.device_type.models import DeviceTypeCatalog
from app.api.device.permissions import DevicePermissions
from app.api.sensor_catalog.models import Sensor, SensorVariable, Variable
from app.core.security import create_access_token

BASE = "/api/devices/types"


def auth(user):
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(name="admin")
def admin_fixture(session, admin_user):
    admin_user.permissions = [DevicePermissions.READ, DevicePermissions.READ_ALL]
    session.add(admin_user)
    session.commit()
    return auth(admin_user)


@pytest.fixture(name="reader")
def reader_fixture(session, test_user):
    test_user.permissions = [DevicePermissions.READ]
    session.add(test_user)
    session.commit()
    return auth(test_user)


@pytest.fixture(name="catalog")
def catalog_fixture(session):
    temperature = Variable(code="temperature", name="Temperatura", unit="°C")
    humidity = Variable(code="relative_humidity", name="Humedad relativa", unit="%")
    dht22 = Sensor(code="dht22", name="DHT22", manufacturer="Aosong")
    bme280 = Sensor(code="bme280", name="BME280", manufacturer="Bosch")
    retired = Sensor(code="old", name="Viejo", manufacturer="Acme", is_active=False)
    session.add_all([temperature, humidity, dht22, bme280, retired])
    session.commit()
    for sensor, variable in ((dht22, temperature), (dht22, humidity), (bme280, temperature)):
        session.add(SensorVariable(sensor_id=sensor.id, variable_id=variable.id, min_value=0,
                                   max_value=50, accuracy="±1", resolution="1"))
    session.commit()
    return {"dht22": dht22, "bme280": bme280, "retired": retired}


def payload(catalog, **overrides):
    body = {
        "code": "weather_station",
        "name": "Estación meteorológica",
        "description": "Mide clima exterior",
        "hardwareModel": "ESP32-S3",
        "telemetryIntervalS": 60,
        "offlineAfterS": 180,
        "minSensors": 1,
        "configTemplate": {"i2c": {"sda": 21, "scl": 22}},
        "sensors": [
            {"sensorId": str(catalog["dht22"].id), "required": False, "maxCount": 2, "includedByDefault": False},
            {"sensorId": str(catalog["bme280"].id), "required": True, "maxCount": 1, "includedByDefault": True},
        ],
    }
    body.update(overrides)
    return body


def test_admin_creates_and_reads_type_with_compatible_sensors(client, admin, catalog):
    created = client.post(BASE, json=payload(catalog), headers=admin)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["code"] == "weather_station"
    assert body["hardwareModel"] == "ESP32-S3"
    assert body["telemetryIntervalS"] == 60 and body["offlineAfterS"] == 180
    assert body["minSensors"] == 1
    assert body["configTemplate"] == {"i2c": {"sda": 21, "scl": 22}}
    assert body["isActive"] is True and body["createdAt"]
    by_code = {row["code"]: row for row in body["sensors"]}
    assert set(by_code) == {"dht22", "bme280"}
    assert by_code["bme280"]["required"] is True and by_code["bme280"]["includedByDefault"] is True
    assert by_code["dht22"]["maxCount"] == 2
    assert [v["code"] for v in by_code["dht22"]["variables"]] == ["relative_humidity", "temperature"]
    assert by_code["dht22"]["variables"][0]["unit"] == "%"

    fetched = client.get(f"{BASE}/{body['id']}", headers=admin)
    assert fetched.status_code == 200
    assert fetched.json() == body


def test_non_admin_can_read_but_not_write(client, reader, admin, catalog):
    created = client.post(BASE, json=payload(catalog), headers=admin).json()
    assert client.get(BASE, headers=reader).status_code == 200
    detail = client.get(f"{BASE}/{created['id']}", headers=reader)
    assert detail.status_code == 200 and len(detail.json()["sensors"]) == 2
    assert client.post(BASE, json=payload(catalog, code="other_one", name="Otro"), headers=reader).status_code == 403
    assert client.put(f"{BASE}/{created['id']}", json={"name": "Nuevo"}, headers=reader).status_code == 403
    assert client.delete(f"{BASE}/{created['id']}", headers=reader).status_code == 403
    assert client.get(BASE).status_code == 401


def test_duplicate_code_or_name_is_a_conflict(client, admin, catalog):
    assert client.post(BASE, json=payload(catalog), headers=admin).status_code == 201
    same_code = client.post(BASE, json=payload(catalog, name="Distinto"), headers=admin)
    assert same_code.status_code == 409
    same_name = client.post(BASE, json=payload(catalog, code="another_code", name="ESTACIÓN meteorológica".lower()), headers=admin)
    assert same_name.status_code == 409


@pytest.mark.parametrize(
    "override",
    [
        {"code": "Bad Code"},
        {"code": ""},
        {"name": " "},
        {"telemetryIntervalS": 1},
        {"telemetryIntervalS": 86401},
        {"offlineAfterS": 2},
        {"telemetryIntervalS": 600, "offlineAfterS": 300},
        {"minSensors": -1},
        {"configTemplate": ["not", "an", "object"]},
        {"minSensors": 5},
    ],
)
def test_invalid_scalar_fields_are_rejected(client, admin, catalog, override):
    response = client.post(BASE, json=payload(catalog, **override), headers=admin)
    assert response.status_code == 422, response.text


def test_invalid_compatible_sensor_sets_are_rejected(client, admin, catalog):
    dht22 = str(catalog["dht22"].id)
    cases = [
        [{"sensorId": dht22, "maxCount": 0}],
        [{"sensorId": dht22}, {"sensorId": dht22}],
        [{"sensorId": str(uuid.uuid4())}],
        [{"sensorId": str(catalog["retired"].id)}],
    ]
    for index, sensors in enumerate(cases):
        response = client.post(
            BASE,
            json=payload(catalog, code=f"case_{index}", name=f"Caso {index}", minSensors=0, sensors=sensors),
            headers=admin,
        )
        assert response.status_code == 422, (index, response.text)
    # A minimum with no compatible sensor at all can never be satisfied.
    unsatisfiable = client.post(BASE, json=payload(catalog, code="empty", name="Vacío", minSensors=1, sensors=[]), headers=admin)
    assert unsatisfiable.status_code == 422


def test_update_replaces_sensor_set_and_keeps_code_immutable(client, admin, catalog):
    created = client.post(BASE, json=payload(catalog), headers=admin).json()
    url = f"{BASE}/{created['id']}"
    assert client.put(url, json={"code": "renamed"}, headers=admin).status_code == 409
    changed = client.put(
        url,
        json={
            "name": "Estación 2",
            "telemetryIntervalS": None,
            "sensors": [{"sensorId": str(catalog["dht22"].id), "maxCount": 3}],
            "minSensors": 2,
        },
        headers=admin,
    )
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert body["name"] == "Estación 2" and body["code"] == "weather_station"
    assert body["telemetryIntervalS"] is None and body["offlineAfterS"] == 180
    assert [(s["code"], s["maxCount"]) for s in body["sensors"]] == [("dht22", 3)]
    # Omitting the field keeps the current set.
    kept = client.put(url, json={"description": None}, headers=admin).json()
    assert [s["code"] for s in kept["sensors"]] == ["dht22"]
    assert client.put(f"{BASE}/{uuid.uuid4()}", json={"name": "x"}, headers=admin).status_code == 404


def test_update_name_conflict_and_deactivate_reactivate(client, admin, catalog):
    first = client.post(BASE, json=payload(catalog), headers=admin).json()
    second = client.post(BASE, json=payload(catalog, code="second", name="Segundo", minSensors=0, sensors=[]), headers=admin).json()
    assert client.put(f"{BASE}/{second['id']}", json={"name": first["name"]}, headers=admin).status_code == 409
    deactivated = client.delete(f"{BASE}/{second['id']}", headers=admin)
    assert deactivated.status_code == 200 and deactivated.json()["isActive"] is False
    active_only = client.get(BASE, params={"is_active": True}, headers=admin).json()
    assert second["id"] not in {item["id"] for item in active_only["items"]}
    reactivated = client.put(f"{BASE}/{second['id']}", json={"isActive": True}, headers=admin)
    assert reactivated.json()["isActive"] is True


def test_list_search_filters_sort_and_pagination(client, admin, catalog):
    client.post(BASE, json=payload(catalog), headers=admin)
    client.post(BASE, json=payload(catalog, code="relay_board", name="Placa de relés", description="Controla bombas",
                                   hardwareModel="ATmega", telemetryIntervalS=30, offlineAfterS=90,
                                   minSensors=0, sensors=[]), headers=admin)
    off = client.post(BASE, json=payload(catalog, code="legacy", name="Legado", hardwareModel=None, description=None,
                                         telemetryIntervalS=None, offlineAfterS=None, minSensors=0,
                                         sensors=[{"sensorId": str(catalog["dht22"].id)}]), headers=admin).json()
    client.delete(f"{BASE}/{off['id']}", headers=admin)

    def names(**params):
        params.setdefault("include_inactive", True)
        response = client.get(BASE, params=params, headers=admin)
        assert response.status_code == 200, response.text
        return [item["name"] for item in response.json()["items"]]

    assert names(search="bombas") == ["Placa de relés"]
    assert names(search="atmega") == ["Placa de relés"]
    assert names(search="esp32") == ["Estación meteorológica"]
    assert names(search="weather") == ["Estación meteorológica"]
    assert names(search="bme280") == ["Estación meteorológica"]  # compatible sensor name
    assert names(search="90") == ["Placa de relés"]  # offline threshold
    assert names(search="inactivo") == ["Legado"]
    assert sorted(names(search="dht22")) == ["Estación meteorológica", "Legado"]
    assert names(search="%") == []  # wildcard characters are literal
    assert sorted(names(is_active=False)) == ["Legado"]
    assert sorted(names()) == ["Ambiental", "Estación meteorológica", "Legado", "Placa de relés"]
    assert sorted(names(sensor_id=str(catalog["bme280"].id))) == ["Estación meteorológica"]
    assert names(hardware_model="ATmega") == ["Placa de relés"]

    expected = {
        "code:asc": ["Ambiental", "Legado", "Placa de relés", "Estación meteorológica"],
        "name:asc": ["Ambiental", "Estación meteorológica", "Legado", "Placa de relés"],
        "hardware_model:asc": ["Placa de relés", "Estación meteorológica", "Ambiental", "Legado"],
        "telemetry_interval_s:asc": ["Placa de relés", "Estación meteorológica", "Ambiental", "Legado"],
        "offline_after_s:desc": ["Estación meteorológica", "Placa de relés", "Ambiental", "Legado"],
        "min_sensors:desc": ["Ambiental", "Estación meteorológica", "Legado", "Placa de relés"],
        "sensors:desc": ["Estación meteorológica", "Legado", "Ambiental", "Placa de relés"],
        "is_active:desc": ["Ambiental", "Placa de relés", "Estación meteorológica", "Legado"],
    }
    for sort, order in expected.items():
        assert names(sort=sort, per_page=10) == order, sort

    page = client.get(BASE, params={"page": 2, "per_page": 2, "sort": "name:asc", "include_inactive": True}, headers=admin).json()
    assert page["total"] == 4 and page["pages"] == 2 and page["page"] == 2 and page["perPage"] == 2
    assert [item["name"] for item in page["items"]] == ["Legado", "Placa de relés"]
    assert client.get(BASE, params={"per_page": 10001}, headers=admin).status_code == 422


def test_default_type_keeps_working_when_listed(client, admin, session):
    listed = client.get(BASE, headers=admin).json()["items"]
    assert any(item["code"] == "environmental" and item["minSensors"] == 1 for item in listed)
    assert session.get(DeviceTypeCatalog, uuid.UUID(listed[0]["id"])) is not None


def test_default_type_cannot_be_deactivated(client, admin):
    from app.api.device.device_type.constants import DEFAULT_DEVICE_TYPE_ID

    client.get(BASE, headers=admin)  # bootstraps the default type
    response = client.delete(f"{BASE}/{DEFAULT_DEVICE_TYPE_ID}", headers=admin)
    assert response.status_code == 409
    renamed = client.put(f"{BASE}/{DEFAULT_DEVICE_TYPE_ID}", json={"hardwareModel": "ESP32"}, headers=admin)
    assert renamed.status_code == 200 and renamed.json()["hardwareModel"] == "ESP32"
