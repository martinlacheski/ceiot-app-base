"""Administrative catalog mutations preserve installed telemetry contracts."""

import uuid

from app.api.sensor_catalog.models import Sensor, SensorVariable, Variable
from app.core.security import create_access_token


def headers(user):
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


def grant(session, user, *, admin=True):
    user.permissions = [*user.permissions, "sensor_catalog:read", "sensor_catalog:write"]
    user.is_admin = admin
    session.add(user)
    session.commit()
    return headers(user)


def test_variable_crud_and_pagination(client, session, test_user):
    auth = grant(session, test_user)
    base = "/api/sensor-catalog/variables"
    assert client.post(base, json={"code": "rain", "name": "Rain", "unit": "mm"}).status_code == 401
    created = client.post(base, json={"code": "rain", "name": "Rain", "unit": "mm",
        "description": "Accumulated rain"}, headers=auth)
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["isActive"] is True
    assert item["description"] == "Accumulated rain"
    assert client.post(base, json={"code": "rain", "name": "Again", "unit": "mm"},
        headers=auth).status_code == 409
    assert client.post(base, json={"code": "Rain Bad", "name": "Bad", "unit": "mm"},
        headers=auth).status_code == 422
    assert client.patch(f"{base}/{item['id']}", json={"code": "other"}, headers=auth).status_code == 409
    edited = client.patch(f"{base}/{item['id']}", json={"name": "Precipitation", "unit": "cm"}, headers=auth)
    assert edited.status_code == 200, edited.text
    assert edited.json()["code"] == "rain"
    assert client.get(f"{base}/{item['id']}", headers=auth).json()["name"] == "Precipitation"
    page = client.get(base, params={"page": 1, "per_page": 10, "search": "precip",
        "sort": "name:desc"}, headers=auth)
    assert page.status_code == 200, page.text
    assert page.json()["items"][0]["id"] == item["id"]
    assert page.json()["perPage"] == 10
    assert client.get(base, params={"page": 1, "per_page": 10001}, headers=auth).status_code == 422
    assert client.delete(f"{base}/{item['id']}", headers=auth).json()["isActive"] is False
    assert client.get(base, params={"page": 1, "is_active": False}, headers=auth).json()["total"] == 1
    assert client.get(base, params={"page": 1, "is_active": True}, headers=auth).json()["total"] == 0
    assert client.get(f"{base}/{uuid.uuid4()}", headers=auth).status_code == 404


def test_sensor_variable_replacement_and_validation(client, session, test_user):
    auth = grant(session, test_user)
    variable = Variable(code="temperature", name="Temperature", unit="°C")
    another = Variable(code="humidity", name="Humidity", unit="%")
    session.add_all([variable, another])
    session.commit()
    base = "/api/sensor-catalog/sensors"
    payload = {"code": "new_dht22", "name": "DHT22", "manufacturer": "Aosong",
        "variables": [{"variableId": str(variable.id), "minValue": -40,
            "maxValue": 80, "accuracy": "0.5", "resolution": "0.1"}]}
    assert client.post(base, json={**payload, "variables": [{**payload["variables"][0],
        "minValue": 90}]}, headers=auth).status_code == 422
    created = client.post(base, json=payload, headers=auth)
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["variables"][0]["variableId"] == str(variable.id)
    assert item["variables"][0]["maxValue"] == 80
    assert client.post(base, json=payload, headers=auth).status_code == 409
    assert client.patch(f"{base}/{item['id']}", json={"code": "renamed"}, headers=auth).status_code == 409
    replacement = [{"variableId": str(another.id), "minValue": 0,
        "maxValue": 100, "accuracy": "2", "resolution": "1"}]
    updated = client.patch(f"{base}/{item['id']}", json={"variables": replacement,
        "name": "Updated"}, headers=auth)
    assert updated.status_code == 200, updated.text
    assert [v["variableId"] for v in updated.json()["variables"]] == [str(another.id)]
    assert session.get(SensorVariable, (uuid.UUID(item["id"]), variable.id)) is None
    assert client.patch(f"{base}/{item['id']}", json={"variables": [replacement[0], replacement[0]]},
        headers=auth).status_code == 422
    assert client.patch(f"{base}/{item['id']}", json={"variables": [{**replacement[0],
        "variableId": str(uuid.uuid4())}]}, headers=auth).status_code == 422
    assert client.delete(f"{base}/{item['id']}", headers=auth).json()["isActive"] is False
    assert client.get(base, params={"page": 1, "is_active": False}, headers=auth).json()["total"] == 1


def test_write_permission_is_admin_only(client, session, test_user):
    auth = grant(session, test_user, admin=False)
    response = client.post("/api/sensor-catalog/variables",
        json={"code": "rain", "name": "Rain", "unit": "mm"}, headers=auth)
    assert response.status_code == 403
    assert client.get("/api/sensor-catalog/variables", params={"page": 1}, headers=auth).status_code == 200


def test_write_permission_is_required(client, session, test_user):
    test_user.is_admin = True
    test_user.permissions = [*test_user.permissions, "sensor_catalog:read"]
    session.add(test_user)
    session.commit()
    assert client.post("/api/sensor-catalog/variables",
        json={"code": "rain", "name": "Rain", "unit": "mm"},
        headers=headers(test_user)).status_code == 403


def test_variable_list_search_filters_and_sort(client, session, test_user):
    auth = grant(session, test_user)
    session.add_all([
        Variable(code="a_rain", name="Rain", unit="mm", description="Accumulated water"),
        Variable(code="b_rain", name="Old rain", unit="mm", description="Legacy", is_active=False),
        Variable(code="c_temperature", name="Temperature", unit="°C", description=None),
    ])
    session.commit()
    base = "/api/sensor-catalog/variables"

    def items(**params):
        response = client.get(base, params={"page": 1, "per_page": 10, **params}, headers=auth)
        assert response.status_code == 200, response.text
        return [row["code"] for row in response.json()["items"]]

    assert items(search="  accumulated  ") == ["a_rain"]
    assert items(search="Inactivo") == ["b_rain"]
    assert items(search="Activo") == ["a_rain", "c_temperature"]
    assert items(search="%") == []
    # "Rain" sorts after "Old rain", so descending by name puts it first.
    assert items(unit="mm", sort="name:desc") == ["a_rain", "b_rain"]
    assert items(sort="unit:asc") == ["a_rain", "b_rain", "c_temperature"]
    assert items(sort="is_active:asc") == ["b_rain", "a_rain", "c_temperature"]


def test_sensor_list_search_filters_and_variable_sort(client, session, test_user):
    auth = grant(session, test_user)
    temperature = Variable(code="temperature", name="Temperature", unit="°C")
    humidity = Variable(code="humidity", name="Humidity", unit="%")
    session.add_all([temperature, humidity])
    session.commit()
    few = Sensor(code="a_few", name="Few", manufacturer="Acme")
    many = Sensor(code="b_many", name="Many", manufacturer="Other", is_active=False)
    empty = Sensor(code="c_empty", name="Empty", manufacturer="Acme")
    session.add_all([few, many, empty])
    session.commit()
    session.add_all([
        SensorVariable(sensor_id=few.id, variable_id=temperature.id, min_value=0,
            max_value=100, accuracy="1", resolution="1"),
        SensorVariable(sensor_id=many.id, variable_id=temperature.id, min_value=0,
            max_value=100, accuracy="1", resolution="1"),
        SensorVariable(sensor_id=many.id, variable_id=humidity.id, min_value=0,
            max_value=100, accuracy="1", resolution="1"),
    ])
    session.commit()
    base = "/api/sensor-catalog/sensors"

    def items(**params):
        response = client.get(base, params={"page": 1, "per_page": 10, **params}, headers=auth)
        assert response.status_code == 200, response.text
        return [row["code"] for row in response.json()["items"]]

    assert items(search="Humidity") == ["b_many"]
    assert items(search="Inactivo") == ["b_many"]
    assert items(search="Activo") == ["a_few", "c_empty"]
    assert items(search="%") == []
    assert items(manufacturer="Acme") == ["a_few", "c_empty"]
    assert items(variable_id=str(humidity.id)) == ["b_many"]
    assert items(sort="variables:desc") == ["b_many", "a_few", "c_empty"]
    assert items(sort="manufacturer:desc") == ["b_many", "a_few", "c_empty"]


def test_sensor_requires_a_variable(client, session, test_user):
    auth = grant(session, test_user)
    base = "/api/sensor-catalog/sensors"
    response = client.post(base, json={"code": "empty", "name": "Empty", "manufacturer": "Acme",
        "variables": []}, headers=auth)
    assert response.status_code == 422, response.text
