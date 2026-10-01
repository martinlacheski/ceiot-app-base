"""SSE pulse: only devices the user can access, heartbeat, refresh, expiry, cleanup."""

import asyncio
import json
import time
import uuid

import fakeredis
import pytest
from fastapi import HTTPException

from app.api.live.service import PulseScope, pulse_stream
from app.core import live
from app.core.redis import get_live_redis
from app.main import app

pytestmark = pytest.mark.asyncio

OWN_DEVICE = uuid.uuid4()
OTHER_DEVICE = uuid.uuid4()


def _pulse(device_id, kind="telemetry"):
    return json.dumps({
        "device_id": str(device_id), "serial": "IOT-0001", "environment_id": str(uuid.uuid4()),
        "kind": kind, "time": "2026-05-01T12:00:00+00:00",
    })


class FakeResolver:
    def __init__(self, scope=None, refreshed=None):
        self.scope = scope
        self.refreshed = refreshed
        self.refresh_calls = 0

    async def authenticate(self, token):
        if token != "valid":
            raise HTTPException(401, "No autorizado")
        return self.scope

    async def refresh(self, scope):
        self.refresh_calls += 1
        return self.refreshed or scope


def _scope(*device_ids, admin=False, expires_in=None):
    return PulseScope(
        user_id=uuid.uuid4(), is_admin=admin, device_ids=frozenset(device_ids),
        expires_at=None if expires_in is None else time.time() + expires_in,
    )


async def _collect(stream, wanted, redis, publishes=(), timeout=3.0):
    """Read frames until ``wanted`` data frames arrived; publish once subscribed."""
    frames = []
    deadline = time.monotonic() + timeout
    published = False
    async for frame in stream:
        frames.append(frame)
        if frame.startswith(": connected") and not published:
            for message in publishes:
                await redis.publish(live.PULSE_CHANNEL, message)
            published = True
        if sum(1 for f in frames if f.startswith("event: pulse")) >= wanted or time.monotonic() > deadline:
            break
    await stream.aclose()
    return frames


def _data(frame):
    return json.loads(frame.split("data: ", 1)[1])


async def test_owner_receives_own_device_pulse_but_not_another_owners():
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    stream = pulse_stream(redis, _scope(OWN_DEVICE), FakeResolver(), heartbeat_seconds=0.2, poll_seconds=0.05)

    frames = await _collect(stream, 1, redis, publishes=[_pulse(OTHER_DEVICE), _pulse(OWN_DEVICE)])

    pulses = [_data(f) for f in frames if f.startswith("event: pulse")]
    assert [p["deviceId"] for p in pulses] == [str(OWN_DEVICE)]
    assert pulses[0]["kind"] == "telemetry"
    assert set(pulses[0]) == {"deviceId", "serial", "environmentId", "kind", "time"}
    assert str(OTHER_DEVICE) not in "".join(frames)


async def test_admin_receives_every_device():
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    stream = pulse_stream(redis, _scope(admin=True), FakeResolver(), heartbeat_seconds=0.2, poll_seconds=0.05)

    frames = await _collect(stream, 2, redis, publishes=[_pulse(OTHER_DEVICE), _pulse(OWN_DEVICE, "presence")])

    assert [_data(f)["kind"] for f in frames if f.startswith("event: pulse")] == ["telemetry", "presence"]


async def test_user_without_devices_receives_nothing_but_heartbeats():
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    stream = pulse_stream(redis, _scope(), FakeResolver(), heartbeat_seconds=0.1, poll_seconds=0.05)

    frames = []
    deadline = time.monotonic() + 2
    async for frame in stream:
        frames.append(frame)
        if frame.startswith(": connected"):
            await redis.publish(live.PULSE_CHANNEL, _pulse(OWN_DEVICE))
        if frame.startswith(": heartbeat") or time.monotonic() > deadline:
            break
    await stream.aclose()
    assert any(f.startswith(": heartbeat") for f in frames)
    assert not any(f.startswith("event: pulse") for f in frames)


async def test_malformed_messages_are_ignored():
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    stream = pulse_stream(redis, _scope(OWN_DEVICE), FakeResolver(), heartbeat_seconds=0.2, poll_seconds=0.05)

    frames = await _collect(stream, 1, redis, publishes=[
        "not json", json.dumps(["list"]), json.dumps({"device_id": "nope"}), _pulse(OWN_DEVICE)])

    assert len([f for f in frames if f.startswith("event: pulse")]) == 1


async def test_scope_is_refreshed_periodically_so_new_devices_start_flowing():
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    resolver = FakeResolver(refreshed=_scope(OWN_DEVICE, OTHER_DEVICE))
    stream = pulse_stream(redis, _scope(OWN_DEVICE), resolver,
                          heartbeat_seconds=5, refresh_seconds=0.1, poll_seconds=0.05)

    async def publish_after_refresh():
        for _ in range(100):
            if resolver.refresh_calls:
                await redis.publish(live.PULSE_CHANNEL, _pulse(OTHER_DEVICE))
                return
            await asyncio.sleep(0.02)

    publisher = asyncio.create_task(publish_after_refresh())
    frames = []
    deadline = time.monotonic() + 3
    async for frame in stream:
        frames.append(frame)
        if frame.startswith("event: pulse") or time.monotonic() > deadline:
            break
    await stream.aclose()
    await publisher
    assert resolver.refresh_calls >= 1
    assert [_data(f)["deviceId"] for f in frames if f.startswith("event: pulse")] == [str(OTHER_DEVICE)]


async def test_stream_ends_with_reauth_when_the_token_expires():
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    stream = pulse_stream(redis, _scope(OWN_DEVICE, expires_in=0.2), FakeResolver(),
                          heartbeat_seconds=5, poll_seconds=0.05)

    frames = [frame async for frame in stream]

    assert frames[0].startswith(": connected")
    assert frames[-1].startswith("event: reauth")


async def test_closing_the_stream_unsubscribes_from_redis():
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    stream = pulse_stream(redis, _scope(OWN_DEVICE), FakeResolver(), heartbeat_seconds=5, poll_seconds=0.05)
    await stream.__anext__()  # connected
    assert (await redis.pubsub_numsub(live.PULSE_CHANNEL))[0][1] == 1

    await stream.aclose()

    assert (await redis.pubsub_numsub(live.PULSE_CHANNEL))[0][1] == 0


async def test_redis_failure_mid_stream_ends_the_stream_cleanly():
    class Broken:
        def pubsub(self, **kwargs):
            return self

        async def subscribe(self, *a):
            return None

        async def get_message(self, **kwargs):
            raise ConnectionError("redis died")

        async def unsubscribe(self, *a):
            return None

        async def aclose(self):
            return None

    stream = pulse_stream(Broken(), _scope(OWN_DEVICE), FakeResolver(), heartbeat_seconds=5, poll_seconds=0.05)
    frames = [frame async for frame in stream]
    assert frames[0].startswith(": connected")
    assert frames[-1].startswith("event: unavailable")
