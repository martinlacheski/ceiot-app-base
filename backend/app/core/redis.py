"""Optional Redis client for the live layer (device state and pulse).

Redis only ever holds derived, expirable data, so the application must keep
working without it: ``get_redis()`` returns ``None`` when ``REDIS_URL`` is not
configured or when a recent failure opened a short circuit, and callers treat
``None`` as "use the database / emit nothing".
"""

import logging
import time

from redis.asyncio import Redis

from app.core.config import settings

logger = logging.getLogger(__name__)

# After a failure Redis is not retried for this long, so a dead Redis costs
# one timeout per window instead of one per MQTT message or request.
RETRY_AFTER_FAILURE_SECONDS = 15.0

_client: Redis | None = None
_down_until = 0.0


def get_redis() -> Redis | None:
    """Return the shared client, or ``None`` when Redis is off or recently failed."""
    global _client
    if not settings.REDIS_URL:
        return None
    if time.monotonic() < _down_until:
        return None
    if _client is None:
        _client = Redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=1.0,
            socket_timeout=3.0,
            health_check_interval=30,
        )
    return _client


def mark_redis_down(error: BaseException) -> None:
    """Open the short circuit and log once per window (never raises)."""
    global _down_until
    now = time.monotonic()
    if now >= _down_until:
        logger.warning("Redis unavailable, degrading to database reads and no live pulse: %s", error)
    _down_until = now + RETRY_AFTER_FAILURE_SECONDS


def reset_redis_state() -> None:
    """Close the circuit and drop the cached client (tests and shutdown)."""
    global _client, _down_until
    _client = None
    _down_until = 0.0


async def close_redis() -> None:
    global _client
    client, _client = _client, None
    if client is not None:
        try:
            await client.aclose()
        except Exception:  # shutdown must never fail because of Redis
            logger.debug("Ignoring Redis close failure", exc_info=True)


def get_live_redis() -> Redis | None:
    """FastAPI dependency: the shared client or ``None`` (override in tests)."""
    return get_redis()
