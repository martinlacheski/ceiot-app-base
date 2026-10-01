"""Fixed-window per-user limiter: Redis when available, in-memory otherwise."""

import fakeredis
import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from app.api.assistant import rate_limit

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _clean():
    rate_limit.reset_memory_state()
    yield
    rate_limit.reset_memory_state()


async def test_memory_limiter_blocks_after_the_limit_and_resets_with_the_window(monkeypatch):
    monkeypatch.setattr(rate_limit, "get_redis", lambda: None)
    clock = [1000.0]
    per_minute = rate_limit.LIMITS[0][1]
    for _ in range(per_minute):
        assert await rate_limit.check_rate_limit("u1", clock=lambda: clock[0]) is None
    retry = await rate_limit.check_rate_limit("u1", clock=lambda: clock[0])
    assert retry is not None and 1 <= retry <= 60
    assert await rate_limit.check_rate_limit("u2", clock=lambda: clock[0]) is None
    clock[0] += 61
    assert await rate_limit.check_rate_limit("u1", clock=lambda: clock[0]) is None


async def test_redis_limiter_shares_the_count_and_expires_keys(monkeypatch):
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rate_limit, "get_redis", lambda: redis)
    per_minute = rate_limit.LIMITS[0][1]
    for _ in range(per_minute):
        assert await rate_limit.check_rate_limit("u1") is None
    assert await rate_limit.check_rate_limit("u1") is not None
    keys = await redis.keys("assistant:rl:u1:*")
    assert keys
    for key in keys:
        assert await redis.ttl(key) > 0


async def test_redis_failure_falls_back_to_memory_and_opens_the_circuit(monkeypatch):
    class Broken:
        def pipeline(self, *args, **kwargs):
            raise RedisConnectionError("down")

    marked = []
    monkeypatch.setattr(rate_limit, "get_redis", lambda: Broken())
    monkeypatch.setattr(rate_limit, "mark_redis_down", marked.append)
    assert await rate_limit.check_rate_limit("u1") is None
    assert marked  # the shared circuit breaker was told
    for _ in range(rate_limit.LIMITS[0][1] - 1):
        await rate_limit.check_rate_limit("u1")
    assert await rate_limit.check_rate_limit("u1") is not None  # memory fallback still enforces the limit
