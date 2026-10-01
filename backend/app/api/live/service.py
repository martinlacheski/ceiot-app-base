"""Live pulse over SSE: access scope resolution and the event stream."""

import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

from fastapi import HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.repository import UserRepository
from app.api.device.models import Device
from app.core.live import PULSE_CHANNEL
from app.core.security import decode_token

logger = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 15.0
REFRESH_SECONDS = 60.0
POLL_SECONDS = 1.0


@dataclass(frozen=True)
class PulseScope:
    """What a connected user may be told about.

    ``device_ids`` is the set of devices the user can read (RLS) at the last
    refresh; admins see every device and carry no list. ``expires_at`` is the
    epoch second the access token expires: the stream ends then so a session
    never outlives its credentials.
    """

    user_id: uuid.UUID
    is_admin: bool
    device_ids: frozenset[uuid.UUID]
    expires_at: float | None = None

    def allows(self, device_id: uuid.UUID) -> bool:
        return self.is_admin or device_id in self.device_ids


class PulseScopeResolver(Protocol):
    async def authenticate(self, token: str) -> PulseScope: ...

    async def refresh(self, scope: PulseScope) -> PulseScope: ...


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No autorizado",
        headers={"WWW-Authenticate": "Bearer"},
    )


class DbPulseScopeResolver:
    """Resolves access with short-lived sessions: no DB connection is held while streaming."""

    def __init__(self, engine: AsyncEngine):
        self.engine = engine

    async def authenticate(self, token: str) -> PulseScope:
        payload = decode_token(token)
        if payload.get("type") == "refresh":
            raise _unauthorized()
        try:
            user_id = uuid.UUID((payload.get("data") or {})["id"])
        except Exception:
            raise _unauthorized()
        async with AsyncSession(self.engine, expire_on_commit=False) as session:
            user = await UserRepository(session).get_by_id(user_id)
        if user is None:
            raise _unauthorized()
        scope = PulseScope(
            user_id=user.id,
            is_admin=bool(user.is_admin),
            device_ids=frozenset(),
            expires_at=float(payload["exp"]) if payload.get("exp") is not None else None,
        )
        return await self.refresh(scope)

    async def refresh(self, scope: PulseScope) -> PulseScope:
        if scope.is_admin:
            return scope
        # Same identity mechanism as get_authed_session: PostgreSQL RLS decides
        # which devices (owned environments, guest grants) this user can read.
        async with self.engine.connect() as connection:
            async with AsyncSession(connection, expire_on_commit=False) as session:
                await session.execute(
                    text("SELECT set_config('app.current_user_id', :uid, false)"),
                    {"uid": str(scope.user_id)},
                )
                rows = (await session.exec(select(Device.id))).all()
        return PulseScope(
            user_id=scope.user_id,
            is_admin=False,
            device_ids=frozenset(rows),
            expires_at=scope.expires_at,
        )


def _frame(event: str, data: dict | None = None) -> str:
    return f"event: {event}\ndata: {json.dumps(data or {})}\n\n"


def _parse_pulse(raw) -> tuple[uuid.UUID, dict] | None:
    """Validate a Redis message and map it to the camelCase browser event."""
    try:
        message = json.loads(raw)
        device_id = uuid.UUID(message["device_id"])
        return device_id, {
            "deviceId": str(device_id),
            "serial": message.get("serial"),
            "environmentId": message.get("environment_id"),
            "kind": message.get("kind"),
            "time": message.get("time"),
        }
    except (ValueError, TypeError, KeyError, AttributeError):
        return None


async def pulse_stream(
    redis: Redis,
    scope: PulseScope,
    resolver: PulseScopeResolver,
    *,
    heartbeat_seconds: float = HEARTBEAT_SECONDS,
    refresh_seconds: float = REFRESH_SECONDS,
    poll_seconds: float = POLL_SECONDS,
) -> AsyncIterator[str]:
    """SSE frames for one connection: filtered pulses, heartbeats, clean shutdown."""
    pubsub = redis.pubsub(ignore_subscribe_messages=True)
    try:
        await pubsub.subscribe(PULSE_CHANNEL)
        yield ": connected\n\n"
        last_beat = last_refresh = time.monotonic()
        while True:
            if scope.expires_at is not None and time.time() >= scope.expires_at:
                yield _frame("reauth")
                return
            try:
                message = await pubsub.get_message(timeout=poll_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Live pulse stream lost Redis: %s", exc)
                yield _frame("unavailable")
                return
            if message is not None:
                parsed = _parse_pulse(message.get("data"))
                if parsed is not None and scope.allows(parsed[0]):
                    yield _frame("pulse", parsed[1])
            now = time.monotonic()
            if now - last_refresh >= refresh_seconds:
                last_refresh = now
                try:
                    scope = await resolver.refresh(scope)
                except Exception:
                    # Keep the last known scope: a transient DB error must not drop the stream.
                    logger.warning("Could not refresh live pulse scope", exc_info=True)
            if now - last_beat >= heartbeat_seconds:
                last_beat = now
                yield ": heartbeat\n\n"
            if message is None:
                # get_message may return immediately on some clients; never spin.
                await asyncio.sleep(0)
    finally:
        try:
            await pubsub.unsubscribe(PULSE_CHANNEL)
            await pubsub.aclose()
        except Exception:
            logger.debug("Ignoring pubsub cleanup failure", exc_info=True)
