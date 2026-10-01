"""Redis live state + pulse writer (never raises, degrades when Redis is down)."""

import json
import uuid
from datetime import datetime, timezone

import fakeredis
import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.core import live
from app.core import redis as redis_module

pytestmark = pytest.mark.asyncio

DEVICE_ID = uuid.UUID("6b1eab89-d1df-47a1-b128-2e9205376fd9")
ENV_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
WHEN = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def redis():
    return fakeredis.FakeAsyncRedis(decode_responses=True)


@pytest.fixture(autouse=True)
def _reset_circuit():
    redis_module.reset_redis_state()
    yield
    redis_module.reset_redis_state()


async def _subscribe(redis):
    pubsub = redis.pubsub(ignore_subscribe_messages=True)
    await pubsub.subscribe(live.PULSE_CHANNEL)
    return pubsub


async def _next_pulse(pubsub):
    message = None
    for _ in range(5):  # the first read may only consume the subscribe confirmation
        message = await pubsub.get_message(timeout=1)
        if message is not None:
            break
    assert message is not None
    return json.loads(message["data"])


async def test_record_telemetry_stores_state_with_ttl_and_publishes_pulse(redis):
    pubsub = await _subscribe(redis)

    await live.record_telemetry(
        redis,
        device_id=DEVICE_ID,
        serial="IOT-0001",
        environment_id=ENV_ID,
        time=WHEN,
        values={"dht22": {"temperature": 21.5}},
        health={"uptime": 99, "firmware_version": "1.2.3", "wifi_rssi": -60, "heap_free": None},
    )

    key = live.state_key(DEVICE_ID)
    state = await redis.hgetall(key)
    assert state["serial"] == "IOT-0001"
    assert state["environment_id"] == str(ENV_ID)
    assert state["telemetry_at"] == "2026-05-01T12:00:00+00:00"
    assert json.loads(state["values"]) == {"dht22": {"temperature": 21.5}}
    # Missing health fields are dropped, never stored as fake values.
    assert json.loads(state["health"]) == {"uptime": 99, "firmware_version": "1.2.3", "wifi_rssi": -60}
    ttl = await redis.ttl(key)
    assert 0 < ttl <= live.STATE_TTL_SECONDS
    assert ttl > 24 * 3600

    pulse = await _next_pulse(pubsub)
    assert pulse == {
        "device_id": str(DEVICE_ID),
        "serial": "IOT-0001",
        "environment_id": str(ENV_ID),
        "kind": "telemetry",
        "time": "2026-05-01T12:00:00+00:00",
    }


async def test_health_only_message_keeps_previous_values_and_updates_health(redis):
    await live.record_telemetry(
        redis, device_id=DEVICE_ID, serial="IOT-0001", environment_id=None, time=WHEN,
        values={"dht22": {"temperature": 21.5}}, health={"uptime": 1},
    )
    later = datetime(2026, 5, 1, 12, 5, tzinfo=timezone.utc)
    await live.record_telemetry(
        redis, device_id=DEVICE_ID, serial="IOT-0001", environment_id=None, time=later,
        values=None, health={"uptime": 300},
    )

    state = await redis.hgetall(live.state_key(DEVICE_ID))
    assert json.loads(state["values"]) == {"dht22": {"temperature": 21.5}}
    assert state["telemetry_at"] == "2026-05-01T12:00:00+00:00"
    assert state["seen_at"] == "2026-05-01T12:05:00+00:00"
    assert json.loads(state["health"]) == {"uptime": 300}
    assert state["environment_id"] == ""


async def test_naive_datetimes_are_treated_as_utc(redis):
    await live.record_telemetry(
        redis, device_id=DEVICE_ID, serial="IOT-0001", environment_id=None,
        time=datetime(2026, 5, 1, 12, 0, 0), values={"a": {"b": 1}}, health={},
    )
    state = await redis.hgetall(live.state_key(DEVICE_ID))
    assert state["telemetry_at"] == "2026-05-01T12:00:00+00:00"


async def test_record_presence_updates_state_and_publishes_presence_pulse(redis):
    pubsub = await _subscribe(redis)

    await live.record_presence(
        redis, device_id=DEVICE_ID, serial="IOT-0001", environment_id=ENV_ID,
        connected=False, time=WHEN,
    )

    state = await redis.hgetall(live.state_key(DEVICE_ID))
    assert state["presence"] == "offline"
    assert state["presence_at"] == "2026-05-01T12:00:00+00:00"
    pulse = await _next_pulse(pubsub)
    assert pulse["kind"] == "presence"
    assert pulse["device_id"] == str(DEVICE_ID)


async def test_read_device_state_parses_hash_and_returns_none_when_absent(redis):
    assert await live.read_device_state(redis, DEVICE_ID) is None
    await live.record_telemetry(
        redis, device_id=DEVICE_ID, serial="IOT-0001", environment_id=ENV_ID, time=WHEN,
        values={"dht22": {"temperature": 21.5}}, health={"uptime": 5},
    )
    state = await live.read_device_state(redis, DEVICE_ID)
    assert state.telemetry_at == WHEN
    assert state.values == {"dht22": {"temperature": 21.5}}
    assert state.health == {"uptime": 5}
    assert state.presence is None


async def test_read_device_state_without_values_has_no_telemetry_time(redis):
    await live.record_presence(
        redis, device_id=DEVICE_ID, serial="IOT-0001", environment_id=None,
        connected=True, time=WHEN,
    )
    state = await live.read_device_state(redis, DEVICE_ID)
    assert state.telemetry_at is None
    assert state.values == {}
    assert state.presence == "online"


class _BrokenRedis:
    def __init__(self):
        self.calls = 0

    def pipeline(self, *args, **kwargs):
        self.calls += 1
        raise RedisConnectionError("redis down")

    async def hgetall(self, *args, **kwargs):
        self.calls += 1
        raise RedisConnectionError("redis down")


async def test_writes_never_raise_when_redis_is_down(caplog):
    broken = _BrokenRedis()
    with caplog.at_level("WARNING"):
        await live.record_telemetry(
            broken, device_id=DEVICE_ID, serial="IOT-0001", environment_id=None,
            time=WHEN, values={"a": {"b": 1}}, health={},
        )
        await live.record_presence(
            broken, device_id=DEVICE_ID, serial="IOT-0001", environment_id=None,
            connected=True, time=WHEN,
        )
    assert "Redis" in caplog.text


async def test_read_returns_none_when_redis_is_down():
    assert await live.read_device_state(_BrokenRedis(), DEVICE_ID) is None


async def test_calls_with_no_client_are_noops():
    await live.record_telemetry(
        None, device_id=DEVICE_ID, serial="IOT-0001", environment_id=None,
        time=WHEN, values=None, health={},
    )
    assert await live.read_device_state(None, DEVICE_ID) is None


async def test_failure_opens_a_short_circuit_so_get_redis_stops_returning_a_client(monkeypatch):
    monkeypatch.setattr(redis_module.settings, "REDIS_URL", "redis://redis:6379/0")
    assert redis_module.get_redis() is not None
    redis_module.mark_redis_down(RedisConnectionError("boom"))
    assert redis_module.get_redis() is None
    redis_module.reset_redis_state()
    assert redis_module.get_redis() is not None


async def test_get_redis_is_none_when_not_configured(monkeypatch):
    monkeypatch.setattr(redis_module.settings, "REDIS_URL", None)
    assert redis_module.get_redis() is None
