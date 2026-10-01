"""Per-user rate limit for assistant questions (each costs 2-3 LLM calls).

Fixed windows, counted per user. Redis is preferred so the limit holds across
processes and restarts; if Redis is off or fails, an in-memory counter keeps
enforcing it per process (and trips the shared Redis circuit breaker).
"""

from __future__ import annotations

import time
from typing import Callable

from redis.exceptions import RedisError

from app.core.redis import get_redis, mark_redis_down

# (window seconds, max requests per window)
LIMITS = ((60, 10), (3600, 120))
_MEMORY_LIMIT = 10_000

_memory: dict[tuple[str, int, int], int] = {}


def reset_memory_state() -> None:
    _memory.clear()


def _retry_after(now: float, window: int) -> int:
    return max(1, int(window - (now % window)))


def _memory_check(user_id: str, now: float) -> int | None:
    if len(_memory) > _MEMORY_LIMIT:
        _memory.clear()
    retry: int | None = None
    for window, limit in LIMITS:
        bucket = int(now // window)
        key = (user_id, window, bucket)
        for stale in [k for k in _memory if k[0] == user_id and k[1] == window and k[2] != bucket]:
            del _memory[stale]
        _memory[key] = _memory.get(key, 0) + 1
        if _memory[key] > limit:
            retry = max(retry or 0, _retry_after(now, window))
    return retry


async def _redis_check(redis, user_id: str, now: float) -> int | None:
    retry: int | None = None
    for window, limit in LIMITS:
        bucket = int(now // window)
        key = f"assistant:rl:{user_id}:{window}:{bucket}"
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, window + 5)
        count, _ = await pipe.execute()
        if count > limit:
            retry = max(retry or 0, _retry_after(now, window))
    return retry


async def check_rate_limit(user_id: str, *, clock: Callable[[], float] = time.time) -> int | None:
    """Count one question; return seconds until allowed again when over a limit, else ``None``."""
    now = clock()
    redis = get_redis()
    if redis is not None:
        try:
            return await _redis_check(redis, user_id, now)
        except (RedisError, OSError) as error:
            mark_redis_down(error)
    return _memory_check(user_id, now)
