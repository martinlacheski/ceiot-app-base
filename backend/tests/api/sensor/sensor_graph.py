"""Shared owner/guest/outsider device-and-environment fixture graph.

Originally lived in test_sensor_readings_router.py (removed in S6 along with
the C10 /sensor-readings endpoints it exercised); kept here because
test_telemetry_api_contract.py still needs this same rich RLS/guest-access
graph to test the current telemetry endpoints under real ownership/guest/
outsider scenarios. Not a test_*.py module on purpose, so pytest does not
try to collect it directly.
"""

from datetime import timedelta

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
        permissions=[],
    )
    guest = User(
        email="sensor-guest@example.com",
        username="sensor_guest",
        password="x",
        permissions=[],
    )
    future_guest = User(
        email="sensor-future-guest@example.com",
        username="sensor_future_guest",
        password="x",
        permissions=[],
    )
    device_guest = User(
        email="sensor-device-guest@example.com",
        username="sensor_device_guest",
        password="x",
        permissions=[],
    )
    outsider = User(
        email="sensor-outsider@example.com",
        username="sensor_outsider",
        password="x",
        permissions=[],
    )
    unrelated_owner = User(
        email="sensor-unrelated-owner@example.com",
        username="sensor_unrelated_owner",
        password="x",
        permissions=[],
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

    # Health-only readings (S6: no environmental columns left on SensorReading).
    readings = []
    for index in range(4):
        reading = SensorReading(
            time=base_time + timedelta(hours=index),
            device_id=device.id,
            device_serial=device.serial,
            device_type="environmental",
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
