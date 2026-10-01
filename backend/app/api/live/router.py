"""``GET /api/live/pulse``: Server-Sent Events with device activity pulses.

Authentication: the browser's ``EventSource`` cannot send an ``Authorization``
header, and putting the access token in the query string would leak it into
proxy/access logs and browser history. The frontend therefore opens the stream
with ``fetch`` and the same ``Authorization: Bearer`` header every other call
uses (refreshing the token on 401), so this endpoint needs no new credential
type. The stream is bound to the token's lifetime: it ends with a ``reauth``
event when the token expires and the client reconnects with a fresh one.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis

from app.api.live.service import DbPulseScopeResolver, PulseScopeResolver, pulse_stream
from app.core.db import async_engine
from app.core.dependencies import oauth2
from app.core.redis import get_live_redis

router = APIRouter()


def get_pulse_scope_resolver() -> PulseScopeResolver:
    return DbPulseScopeResolver(async_engine)


@router.get("/pulse")
async def live_pulse(
    token: Annotated[str, Depends(oauth2)],
    resolver: Annotated[PulseScopeResolver, Depends(get_pulse_scope_resolver)],
    redis: Annotated[Redis | None, Depends(get_live_redis)],
):
    # Deliberately no DB session dependency: it would stay checked out for the
    # whole stream. Access is resolved with short-lived sessions in the resolver.
    scope = await resolver.authenticate(token)
    if redis is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El pulso en vivo no está disponible",
        )
    return StreamingResponse(
        pulse_stream(redis, scope, resolver),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
