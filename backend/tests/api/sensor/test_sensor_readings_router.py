from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.auth.models import User
from app.api.device.models import Device, DeviceStatus
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.api.sensor.models import SensorReading
from app.core.security import create_access_token
from app.core.time import utc_now


SENSOR_READ_PERMISSION = "sensor:read"


def make_token(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


def auth_headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user.id)}"}


def seed_sensor_graph(session: Session):
    country = LocationCountry(name="AR Sensor Readings")
    session.add(country)
    session.commit()
    session.refresh(country)

    state = LocationState(name="Sensor State", country_id=country.id)
    session.add(state)
    session.commit()
    session.refresh(state)

    city = LocationCity(name="Sensor City", postal_code="5000", state_id=state.id)
    env_type = EnvironmentType(name="Sensor Lab")
    session.add(city)
    session.add(env_type)
    session.commit()
    session.refresh(city)
    session.refresh(env_type)

    owner = User(
        email="sensor-owner@example.com",
        username="sensor_owner",
        password="x",
        permissions=[SENSOR_READ_PERMISSION],
    )
    guest = User(
        email="sensor-guest@example.com",
        username="sensor_guest",
        password="x",
        permissions=[SENSOR_READ_PERMISSION],
    )
    future_guest = User(
        email="sensor-future-guest@example.com",
        username="sensor_future_guest",
        password="x",
        permissions=[SENSOR_READ_PERMISSION],
    )
    device_guest = User(
        email="sensor-device-guest@example.com",
        username="sensor_device_guest",
        password="x",
        permissions=[SENSOR_READ_PERMISSION],
    )
    outsider = User(
        email="sensor-outsider@example.com",
        username="sensor_outsider",
        password="x",
        permissions=[SENSOR_READ_PERMISSION],
    )
    unrelated_owner = User(
        email="sensor-unrelated-owner@example.com",
        username="sensor_unrelated_owner",
        password="x",
        permissions=[SENSOR_READ_PERMISSION],
    )
    session.add_all(
        [owner, guest, future_guest, device_guest, outsider, unrelated_owner]
    )
    session.commit()
    for user in (
        owner,
        guest,
        future_guest,
        device_guest,
        outsider,
        unrelated_owner,
    ):
        session.refresh(user)

    environment = Environment(
        name="Sensor Environment",
        address="Sensor Street 1",
        location="Sensor Room",
        description="Environmental sensor tests",
        city_id=city.id,
        type_id=env_type.id,
    )
    session.add(environment)
    session.commit()
    session.refresh(environment)
    session.add(
        EnvironmentUser(
            environment_id=environment.id,
            user_id=owner.id,
            is_owner=True,
            is_active=True,
        )
    )
    unrelated_environment = Environment(
        name="Unrelated Sensor Environment",
        address="Other Sensor Street 2",
        location="Other Sensor Room",
        description="Separate tenant",
        city_id=city.id,
        type_id=env_type.id,
    )
    session.add(unrelated_environment)
    session.commit()
    session.refresh(unrelated_environment)
    session.add(
        EnvironmentUser(
            environment_id=unrelated_environment.id,
            user_id=unrelated_owner.id,
            is_owner=True,
            is_active=True,
        )
    )

    device = Device(
        serial="IOT-SENS-0010",
        name="Environmental Sensor",
        status=DeviceStatus.PAIRED,
        environment_id=environment.id,
    )
    other_device = Device(
        serial="IOT-SENS-0011",
        name="Other Environmental Sensor",
        status=DeviceStatus.PAIRED,
        environment_id=environment.id,
    )
    session.add_all([device, other_device])
    session.commit()
    session.refresh(device)
    session.refresh(other_device)

    base_time = utc_now().replace(microsecond=0) - timedelta(hours=4)
    session.add(
        ScopedGuestRelation(
            owner_user_id=owner.id,
            guest_user_id=guest.id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=environment.id,
            access_starts_at=base_time + timedelta(hours=1),
        )
    )
    session.add(
        ScopedGuestRelation(
            owner_user_id=owner.id,
            guest_user_id=device_guest.id,
            scope_type=ScopeType.DEVICE,
            scope_id=device.id,
            access_starts_at=base_time + timedelta(hours=2),
        )
    )
    session.add(
        ScopedGuestRelation(
            owner_user_id=owner.id,
            guest_user_id=outsider.id,
            scope_type=ScopeType.DEVICE,
            scope_id=device.id,
            access_starts_at=base_time,
            is_active=False,
        )
    )
    session.add(
        ScopedGuestRelation(
            owner_user_id=owner.id,
            guest_user_id=future_guest.id,
            scope_type=ScopeType.DEVICE,
            scope_id=device.id,
            access_starts_at=utc_now() + timedelta(hours=1),
        )
    )

    readings = []
    for index in range(4):
        reading = SensorReading(
            time=base_time + timedelta(hours=index),
            device_id=device.id,
            device_serial=device.serial,
            device_type="environmental",
            temperature_c=20.0 + index,
            relative_humidity_pct=50.0 + index,
            pressure_hpa=1000.0 + index,
            uptime=100 + index,
            wifi_rssi=-40 - index,
        )
        readings.append(reading)
        session.add(reading)
    session.add(
        SensorReading(
            time=base_time + timedelta(hours=3),
            device_id=other_device.id,
            device_serial=other_device.serial,
            temperature_c=99.0,
        )
    )
    session.commit()

    return {
        "owner": owner,
        "guest": guest,
        "future_guest": future_guest,
        "device_guest": device_guest,
        "outsider": outsider,
        "unrelated_owner": unrelated_owner,
        "device": device,
        "other_device": other_device,
        "readings": readings,
        "base_time": base_time,
    }


def test_owner_gets_latest_and_bounded_history_readings(
    client: TestClient,
    session: Session,
):
    seed = seed_sensor_graph(session)
    device_id = seed["device"].id
    headers = auth_headers(seed["owner"])

    latest = client.get(
        f"/api/devices/{device_id}/sensor-readings/latest",
        params={"limit": 2},
        headers=headers,
    )
    history = client.get(
        f"/api/devices/{device_id}/sensor-readings/history",
        params={
            "start": (seed["base_time"] + timedelta(hours=1)).isoformat(),
            "end": (seed["base_time"] + timedelta(hours=2)).isoformat(),
        },
        headers=headers,
    )

    assert latest.status_code == 200
    assert latest.json()["total"] == 4
    assert [item["temperatureC"] for item in latest.json()["items"]] == [23.0, 22.0]
    assert all(item["deviceId"] == str(device_id) for item in latest.json()["items"])
    assert latest.json()["items"][0]["relativeHumidityPct"] == 53.0
    assert latest.json()["items"][0]["pressureHpa"] == 1003.0
    assert latest.json()["items"][0]["wifiRssi"] == -43

    assert history.status_code == 200
    assert history.json()["total"] == 2
    assert [item["temperatureC"] for item in history.json()["items"]] == [21.0, 22.0]


def test_current_guest_gets_only_readings_at_or_after_access_start(
    client: TestClient,
    session: Session,
):
    seed = seed_sensor_graph(session)
    response = client.get(
        f"/api/devices/{seed['device'].id}/sensor-readings/history",
        params={
            "start": seed["base_time"].isoformat(),
            "end": (seed["base_time"] + timedelta(hours=3)).isoformat(),
        },
        headers=auth_headers(seed["guest"]),
    )

    assert response.status_code == 200
    assert response.json()["total"] == 3
    assert [item["temperatureC"] for item in response.json()["items"]] == [21.0, 22.0, 23.0]


def test_current_device_scoped_guest_gets_readings_after_access_start(
    client: TestClient,
    session: Session,
):
    seed = seed_sensor_graph(session)
    response = client.get(
        f"/api/devices/{seed['device'].id}/sensor-readings/latest",
        params={"limit": 10},
        headers=auth_headers(seed["device_guest"]),
    )

    assert response.status_code == 200
    assert response.json()["total"] == 2
    assert [item["temperatureC"] for item in response.json()["items"]] == [23.0, 22.0]


def test_guest_with_future_access_start_is_denied(
    client: TestClient,
    session: Session,
):
    seed = seed_sensor_graph(session)
    response = client.get(
        f"/api/devices/{seed['device'].id}/sensor-readings/latest",
        headers=auth_headers(seed["future_guest"]),
    )

    assert response.status_code == 403


def test_user_with_revoked_relation_cannot_read_sensor_data(
    client: TestClient,
    session: Session,
):
    seed = seed_sensor_graph(session)
    response = client.get(
        f"/api/devices/{seed['device'].id}/sensor-readings/latest",
        headers=auth_headers(seed["outsider"]),
    )

    assert response.status_code in {403, 404}
    assert "items" not in response.json()


def test_owner_from_another_tenant_cannot_read_sensor_data(
    client: TestClient,
    session: Session,
):
    seed = seed_sensor_graph(session)
    response = client.get(
        f"/api/devices/{seed['device'].id}/sensor-readings/latest",
        headers=auth_headers(seed["unrelated_owner"]),
    )

    assert response.status_code in {403, 404}
    assert "items" not in response.json()


def test_empty_history_range_returns_empty_list(
    client: TestClient,
    session: Session,
):
    seed = seed_sensor_graph(session)
    response = client.get(
        f"/api/devices/{seed['device'].id}/sensor-readings/history",
        params={
            "start": (seed["base_time"] + timedelta(days=1)).isoformat(),
            "end": (seed["base_time"] + timedelta(days=2)).isoformat(),
        },
        headers=auth_headers(seed["owner"]),
    )

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0}


def test_latest_limit_is_bounded_without_counting_another_device(
    client: TestClient,
    session: Session,
):
    seed = seed_sensor_graph(session)
    response = client.get(
        f"/api/devices/{seed['device'].id}/sensor-readings/latest",
        params={"limit": 1},
        headers=auth_headers(seed["owner"]),
    )

    assert response.status_code == 200
    assert response.json()["total"] == 4
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["temperatureC"] == 23.0


def test_reversed_history_range_is_rejected(
    client: TestClient,
    session: Session,
):
    seed = seed_sensor_graph(session)
    response = client.get(
        f"/api/devices/{seed['device'].id}/sensor-readings/history",
        params={
            "start": (seed["base_time"] + timedelta(hours=3)).isoformat(),
            "end": seed["base_time"].isoformat(),
        },
        headers=auth_headers(seed["owner"]),
    )

    assert response.status_code == 422
