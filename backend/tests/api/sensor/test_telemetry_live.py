"""GET /devices/{id}/telemetry/live: Redis fast path with database fallback."""

import uuid
from datetime import datetime, timezone

import fakeredis
import pytest
from fastapi import HTTPException

from app.api.device.models import Device
from app.api.sensor.models import Telemetry
from app.api.sensor_catalog import router as module
from app.api.sensor_catalog.models import DeviceSensor, Sensor, SensorVariable, Variable
from app.core import live
from app.core.redis import get_live_redis
from app.core.security import create_access_token
from app.main import app

pytestmark = pytest.mark.asyncio

WHEN = datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)


def _headers(user):
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def seeded(session, test_user):
    test_user.permissions = [*test_user.permissions, "telemetry:read"]
    variable = Variable(code="temperature", name="Temperatura", unit="°C")
    sensor = Sensor(code="dht22", name="DHT22", manufacturer="Aosong")
    device = Device(serial="IOT-LIVE-0002", name="Live device")
    session.add_all([test_user, variable, sensor, device])
    session.commit()
    session.add_all([
        SensorVariable(sensor_id=sensor.id, variable_id=variable.id, min_value=-40, max_value=80,
                       accuracy="1", resolution="0.1"),
        DeviceSensor(device_id=device.id, sensor_id=sensor.id, key="dht22"),
    ])
    session.commit()
    return device


@pytest.fixture
def allow_access(monkeypatch):
    async def none(*args, **kwargs):
        return None

    monkeypatch.setattr(module, "_resolve_access_start", none)


def _use_redis(client_obj):
    app.dependency_overrides[get_live_redis] = lambda: client_obj


async def test_served_from_redis_when_present(client, seeded, test_user, allow_access):
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    await live.record_telemetry(
        redis, device_id=seeded.id, serial=seeded.serial, environment_id=None, time=WHEN,
        values={"dht22": {"temperature": 21.5}}, health={"uptime": 9, "wifi_rssi": -61},
    )
    await live.record_presence(
        redis, device_id=seeded.id, serial=seeded.serial, environment_id=None, connected=True, time=WHEN,
    )
    _use_redis(redis)

    response = client.get(f"/api/devices/{seeded.id}/telemetry/live", headers=_headers(test_user))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "redis"
    assert body["time"].startswith("2026-05-01T12:00:00")
    assert body["values"] == {"dht22": {"temperature": 21.5}}
    assert body["health"] == {"uptime": 9, "wifi_rssi": -61}
    assert body["presence"] == "online"
    assert body["sensors"][0]["key"] == "dht22"
    assert body["sensors"][0]["variables"][0]["unit"] == "°C"


async def test_falls_back_to_database_when_redis_has_no_state(client, session, seeded, test_user, allow_access):
    session.add(Telemetry(time=WHEN, device_id=seeded.id, device_serial=seeded.serial,
                          values={"dht22": {"temperature": 19.0}}))
    session.commit()
    _use_redis(fakeredis.FakeAsyncRedis(decode_responses=True))

    body = client.get(f"/api/devices/{seeded.id}/telemetry/live", headers=_headers(test_user)).json()

    assert body["source"] == "database"
    assert body["values"] == {"dht22": {"temperature": 19.0}}
    assert body["time"].startswith("2026-05-01T12:00:00")


async def test_falls_back_to_database_when_redis_is_down_or_unconfigured(
    client, session, seeded, test_user, allow_access
):
    session.add(Telemetry(time=WHEN, device_id=seeded.id, device_serial=seeded.serial,
                          values={"dht22": {"temperature": 18.0}}))
    session.commit()

    class Broken:
        async def hgetall(self, *a, **k):
            raise ConnectionError("down")

    for redis in (Broken(), None):
        _use_redis(redis)
        response = client.get(f"/api/devices/{seeded.id}/telemetry/live", headers=_headers(test_user))
        assert response.status_code == 200
        assert response.json()["source"] == "database"
        assert response.json()["values"] == {"dht22": {"temperature": 18.0}}


async def test_empty_when_no_telemetry_anywhere(client, seeded, test_user, allow_access):
    _use_redis(None)
    body = client.get(f"/api/devices/{seeded.id}/telemetry/live", headers=_headers(test_user)).json()
    assert body["source"] == "database"
    assert body["values"] == {}
    assert body.get("time") is None


async def test_authorization_is_checked_before_redis_is_read(client, seeded, test_user, monkeypatch):
    class Spy:
        touched = False

        async def hgetall(self, *a, **k):
            Spy.touched = True
            return {}

    async def deny(*args, **kwargs):
        raise HTTPException(403, "No tienes acceso contextual a este dispositivo")

    monkeypatch.setattr(module, "_resolve_access_start", deny)
    _use_redis(Spy())
    response = client.get(f"/api/devices/{seeded.id}/telemetry/live", headers=_headers(test_user))
    assert response.status_code == 403
    assert Spy.touched is False


async def test_requires_authentication_and_telemetry_permission(client, seeded, test_user, session, allow_access):
    _use_redis(None)
    assert client.get(f"/api/devices/{seeded.id}/telemetry/live").status_code == 401
    test_user.permissions = [p for p in test_user.permissions if p != "telemetry:read"]
    session.add(test_user)
    session.commit()
    assert client.get(f"/api/devices/{seeded.id}/telemetry/live",
                      headers=_headers(test_user)).status_code == 403


async def test_guest_never_sees_state_older_than_their_access_start(client, seeded, test_user, monkeypatch):
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    await live.record_telemetry(
        redis, device_id=seeded.id, serial=seeded.serial, environment_id=None, time=WHEN,
        values={"dht22": {"temperature": 21.5}}, health={},
    )

    async def access_after_the_reading(*args, **kwargs):
        return datetime(2026, 5, 2)  # naive UTC, like the access grant

    monkeypatch.setattr(module, "_resolve_access_start", access_after_the_reading)
    _use_redis(redis)

    body = client.get(f"/api/devices/{seeded.id}/telemetry/live", headers=_headers(test_user)).json()
    assert body["source"] == "database"
    assert body["values"] == {}
