"""Live device state and pulse on Redis.

The MQTT runtime writes the latest state of every device (hash per device) and
publishes a small pulse on ``iot:pulse`` after each stored message. The API
serves the latest telemetry from the hash and forwards pulses to browsers over
SSE (see ``app.api.live``). Every function here is best effort: a Redis
failure is logged and swallowed so ingestion and reads never break.
"""

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from redis.asyncio import Redis

from app.core.redis import mark_redis_down

logger = logging.getLogger(__name__)

PULSE_CHANNEL = "iot:pulse"
# Generous: the key is a cache of the last known state, refreshed on every
# message; a device silent for a week is better served by the database.
STATE_TTL_SECONDS = 7 * 24 * 3600

PulseKind = Literal["telemetry", "status", "presence"]


def state_key(device_id: uuid.UUID | str) -> str:
    return f"iot:device:{device_id}:state"


def _iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _pulse(device_id, serial: str, environment_id, kind: PulseKind, time: datetime) -> str:
    return json.dumps(
        {
            "device_id": str(device_id),
            "serial": serial,
            "environment_id": str(environment_id) if environment_id else None,
            "kind": kind,
            "time": _iso(time),
        }
    )


async def _write(redis: Redis | None, device_id, mapping: dict[str, str], pulse: str) -> None:
    if redis is None:
        return
    key = state_key(device_id)
    try:
        pipe = redis.pipeline(transaction=False)
        pipe.hset(key, mapping=mapping)
        pipe.expire(key, STATE_TTL_SECONDS)
        pipe.publish(PULSE_CHANNEL, pulse)
        await pipe.execute()
    except Exception as exc:  # Redis must never break ingestion
        mark_redis_down(exc)


async def record_telemetry(
    redis: Redis | None,
    *,
    device_id: uuid.UUID,
    serial: str,
    environment_id: uuid.UUID | None,
    time: datetime,
    values: dict | None,
    health: dict[str, Any],
) -> None:
    """Store the latest telemetry/health of a device and emit a ``telemetry`` pulse.

    ``values`` is ``None`` for a health-only message: the previous values stay.
    """
    mapping = {
        "serial": serial,
        "environment_id": str(environment_id) if environment_id else "",
        "seen_at": _iso(time),
        "health": json.dumps({k: v for k, v in health.items() if v is not None}),
    }
    if values:
        mapping["values"] = json.dumps(values)
        mapping["telemetry_at"] = _iso(time)
    await _write(redis, device_id, mapping, _pulse(device_id, serial, environment_id, "telemetry", time))


async def record_presence(
    redis: Redis | None,
    *,
    device_id: uuid.UUID,
    serial: str,
    environment_id: uuid.UUID | None,
    connected: bool,
    time: datetime,
) -> None:
    """Store the broker presence of a device and emit a ``presence`` pulse."""
    mapping = {
        "serial": serial,
        "environment_id": str(environment_id) if environment_id else "",
        "presence": "online" if connected else "offline",
        "presence_at": _iso(time),
    }
    await _write(redis, device_id, mapping, _pulse(device_id, serial, environment_id, "presence", time))


@dataclass(frozen=True)
class DeviceState:
    serial: str
    environment_id: uuid.UUID | None
    telemetry_at: datetime | None
    values: dict
    health: dict
    presence: str | None
    presence_at: datetime | None = None
    seen_at: datetime | None = None
    extra: dict = field(default_factory=dict)


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


async def read_device_state(redis: Redis | None, device_id: uuid.UUID) -> DeviceState | None:
    """Latest state of a device, or ``None`` when absent or Redis is unavailable."""
    if redis is None:
        return None
    try:
        raw = await redis.hgetall(state_key(device_id))
    except Exception as exc:
        mark_redis_down(exc)
        return None
    if not raw:
        return None
    try:
        values = json.loads(raw.get("values") or "{}")
        health = json.loads(raw.get("health") or "{}")
    except json.JSONDecodeError:
        logger.warning("Ignoring corrupt live state for device %s", device_id)
        return None
    environment_id = raw.get("environment_id") or None
    return DeviceState(
        serial=raw.get("serial", ""),
        environment_id=uuid.UUID(environment_id) if environment_id else None,
        telemetry_at=_parse_time(raw.get("telemetry_at")),
        values=values if isinstance(values, dict) else {},
        health=health if isinstance(health, dict) else {},
        presence=raw.get("presence"),
        presence_at=_parse_time(raw.get("presence_at")),
        seen_at=_parse_time(raw.get("seen_at")),
    )
