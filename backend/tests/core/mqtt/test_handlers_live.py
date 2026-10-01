"""MQTT runtime -> Redis live state + pulse (after the database write)."""

import json
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import fakeredis
import pytest
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlmodel import select

from app.api.device.repository import DeviceRepository
from app.api.sensor.models import SensorReading, Telemetry
from app.api.sensor.repository import SensorRepository
from app.core import live
from app.core.mqtt import handlers

pytestmark = pytest.mark.asyncio

ENV_ID = uuid.uuid4()
CAPABILITIES = [("dht22", "temperature", -40, 80)]


@pytest.fixture
def redis(monkeypatch):
    client = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(handlers, "get_redis", lambda: client)
    return client


@pytest.fixture
def device_context(monkeypatch, engine, async_session):
    del engine
    device = SimpleNamespace(id=uuid.uuid4(), serial="IOT-LIVE-0001", environment_id=ENV_ID)

    @asynccontextmanager
    async def test_system_session():
        yield async_session

    async def get_by_serial(self, serial):
        return device

    async def register_runtime_report(self, *args, **kwargs):
        return None

    async def update_broker_presence(self, serial, is_connected):
        return device

    async def capabilities(self, device_id):
        return CAPABILITIES

    monkeypatch.setattr(handlers, "system_session", test_system_session)
    monkeypatch.setattr(DeviceRepository, "get_by_serial", get_by_serial)
    monkeypatch.setattr(DeviceRepository, "register_runtime_report", register_runtime_report)
    monkeypatch.setattr(DeviceRepository, "update_broker_presence", update_broker_presence)
    monkeypatch.setattr(SensorRepository, "get_active_sensor_capabilities", capabilities)
    return device


async def _pulses(redis):
    pubsub = redis.pubsub(ignore_subscribe_messages=True)
    await pubsub.subscribe(live.PULSE_CHANNEL)
    return pubsub


async def _drain(pubsub):
    out = []
    for _ in range(5):
        message = await pubsub.get_message(timeout=0.2)
        if message is not None:
            out.append(json.loads(message["data"]))
    return out


async def test_telemetry_updates_redis_state_and_publishes_pulse(redis, device_context, async_session):
    pubsub = await _pulses(redis)
    await handlers.process_sensor_message_pub(
        "iot/devices/IOT-LIVE-0001/telemetry",
        json.dumps({
            "sensors": {"dht22": {"temperature": 23.4}, "missing": {"x": 1}},
            "uptime": 120, "firmware_version": "1.2.3", "wifi_rssi": -55,
        }),
    )

    stored = (await async_session.exec(select(Telemetry))).all()
    assert len(stored) == 1
    state = await live.read_device_state(redis, device_context.id)
    # Only validated values reach Redis, with the exact stored timestamp.
    assert state.values == {"dht22": {"temperature": 23.4}}
    assert state.telemetry_at == stored[0].time.replace(tzinfo=state.telemetry_at.tzinfo)
    assert state.health == {"uptime": 120, "firmware_version": "1.2.3", "wifi_rssi": -55}
    assert state.environment_id == ENV_ID

    pulses = await _drain(pubsub)
    assert [p["kind"] for p in pulses] == ["telemetry"]
    assert pulses[0]["device_id"] == str(device_context.id)
    assert pulses[0]["serial"] == "IOT-LIVE-0001"
    assert pulses[0]["environment_id"] == str(ENV_ID)


async def test_health_only_message_updates_health_and_pulses_without_values(redis, device_context):
    pubsub = await _pulses(redis)
    await handlers.process_sensor_message_pub(
        "iot/devices/IOT-LIVE-0001/telemetry", json.dumps({"uptime": 77}),
    )
    state = await live.read_device_state(redis, device_context.id)
    assert state.values == {}
    assert state.telemetry_at is None
    assert state.health == {"uptime": 77}
    assert [p["kind"] for p in await _drain(pubsub)] == ["telemetry"]


async def test_unknown_device_writes_nothing_to_redis(redis, monkeypatch, device_context):
    async def no_device(self, serial):
        return None

    monkeypatch.setattr(DeviceRepository, "get_by_serial", no_device)
    await handlers.process_sensor_message_pub(
        "iot/devices/UNKNOWN-1/telemetry", json.dumps({"sensors": {"dht22": {"temperature": 1}}}),
    )
    assert await redis.keys("iot:device:*") == []


async def test_redis_failure_does_not_break_database_ingestion(monkeypatch, device_context, async_session):
    class Broken:
        def pipeline(self, *a, **k):
            raise RedisConnectionError("down")

    monkeypatch.setattr(handlers, "get_redis", lambda: Broken())
    await handlers.process_sensor_message_pub(
        "iot/devices/IOT-LIVE-0001/telemetry",
        json.dumps({"sensors": {"dht22": {"temperature": 23.4}}, "uptime": 5}),
    )
    assert len((await async_session.exec(select(Telemetry))).all()) == 1
    assert len((await async_session.exec(select(SensorReading))).all()) == 1


async def test_status_message_records_presence_and_publishes_presence_pulse(redis, device_context):
    pubsub = await _pulses(redis)
    await handlers.process_device_status_message("iot/devices/IOT-LIVE-0001/status", "online")
    state = await live.read_device_state(redis, device_context.id)
    assert state.presence == "online"
    pulses = await _drain(pubsub)
    assert [p["kind"] for p in pulses] == ["presence"]
    assert pulses[0]["device_id"] == str(device_context.id)


async def test_presence_with_incomplete_device_row_does_not_fail(redis, monkeypatch, device_context):
    async def odd_device(self, serial, is_connected):
        return object()  # no id: must not raise nor write

    monkeypatch.setattr(DeviceRepository, "update_broker_presence", odd_device)
    await handlers.process_device_status_message("iot/devices/IOT-LIVE-0001/status", "offline")
    assert await redis.keys("iot:device:*") == []
