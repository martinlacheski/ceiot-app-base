"""HTTP surface of GET /api/live/pulse (auth, availability, SSE headers)."""

import time
import uuid

import fakeredis
import pytest

from app.api.live.service import PulseScope
from app.core.redis import get_live_redis
from app.main import app
from fastapi import HTTPException

DEVICE = uuid.uuid4()


class FakeResolver:
    def __init__(self, scope):
        self.scope = scope

    async def authenticate(self, token):
        if token != "valid":
            raise HTTPException(401, "No autorizado")
        return self.scope

    async def refresh(self, scope):
        return scope


def _scope(expires_in=None):
    return PulseScope(
        user_id=uuid.uuid4(), is_admin=False, device_ids=frozenset({DEVICE}),
        expires_at=None if expires_in is None else time.time() + expires_in,
    )


@pytest.fixture
def stream_app(client):
    from app.api.live.router import get_pulse_scope_resolver

    def install(resolver, redis):
        app.dependency_overrides[get_pulse_scope_resolver] = lambda: resolver
        app.dependency_overrides[get_live_redis] = lambda: redis

    return install


def test_requires_a_bearer_token(client, stream_app):
    stream_app(FakeResolver(_scope()), None)
    assert client.get("/api/live/pulse").status_code == 401


def test_invalid_token_is_rejected(client, stream_app):
    stream_app(FakeResolver(_scope()), fakeredis.FakeAsyncRedis(decode_responses=True))
    response = client.get("/api/live/pulse", headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


def test_returns_503_when_redis_is_unavailable(client, stream_app):
    stream_app(FakeResolver(_scope()), None)
    response = client.get("/api/live/pulse", headers={"Authorization": "Bearer valid"})
    assert response.status_code == 503
    assert "en vivo" in response.json()["detail"]


def test_streams_event_stream_headers_and_ends_on_expiry(client, stream_app):
    stream_app(FakeResolver(_scope(expires_in=0.3)),
               fakeredis.FakeAsyncRedis(decode_responses=True))
    with client.stream("GET", "/api/live/pulse", headers={"Authorization": "Bearer valid"}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"
        body = "".join(response.iter_text())
    assert body.startswith(": connected")
    assert "event: reauth" in body
