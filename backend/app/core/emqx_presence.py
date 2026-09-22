import asyncio
import logging
import threading
import time
from dataclasses import dataclass
from collections.abc import Callable
from typing import Iterable

import httpx

from app.api.device.service import DeviceService
from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PresenceSnapshot:
    available: bool
    client_ids: frozenset[str] | None

    @classmethod
    def available_with(cls, client_ids: Iterable[str]) -> "PresenceSnapshot":
        return cls(available=True, client_ids=frozenset(client_ids))

    @classmethod
    def unavailable(cls) -> "PresenceSnapshot":
        return cls(available=False, client_ids=None)


class EmqxPresenceClient:
    CACHE_TTL_SECONDS = 3.0
    PAGE_SIZE = 100

    def __init__(
        self,
        base_url: str | None,
        api_key: str | None,
        api_secret: str | None,
        mqtt_client_id: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        max_pages: int = 100,
        refresh_deadline_seconds: float = 2.5,
    ) -> None:
        self._base_url = base_url.rstrip("/") if base_url else None
        self._api_key = api_key
        self._api_secret = api_secret
        self._mqtt_client_id = mqtt_client_id
        self._transport = transport
        self._clock = clock
        self._max_pages = max_pages
        self._refresh_deadline_seconds = refresh_deadline_seconds
        self._state_lock = threading.Lock()
        self._cached: tuple[float, PresenceSnapshot] | None = None
        self._inflight: dict[asyncio.AbstractEventLoop, asyncio.Task[PresenceSnapshot]] = {}

    async def get_snapshot(self) -> PresenceSnapshot:
        now = self._clock()
        with self._state_lock:
            if self._cached and now < self._cached[0]:
                return self._cached[1]
            loop = asyncio.get_running_loop()
            task = self._inflight.get(loop)
            if task is None:
                task = loop.create_task(self._fetch_and_cache())
                self._inflight[loop] = task
                task.add_done_callback(lambda completed: self._clear_inflight(loop, completed))
        return await asyncio.shield(task)

    def _clear_inflight(
        self,
        loop: asyncio.AbstractEventLoop,
        task: asyncio.Task[PresenceSnapshot],
    ) -> None:
        with self._state_lock:
            if self._inflight.get(loop) is task:
                self._inflight.pop(loop, None)

    async def _fetch_and_cache(self) -> PresenceSnapshot:
        snapshot = await self._refresh_safely()
        with self._state_lock:
            self._cached = (self._clock() + self.CACHE_TTL_SECONDS, snapshot)
        return snapshot

    async def _refresh_safely(self) -> PresenceSnapshot:
        if not self._base_url or not self._api_key or not self._api_secret:
            return PresenceSnapshot.unavailable()
        try:
            async with asyncio.timeout(self._refresh_deadline_seconds):
                return await self._fetch_snapshot()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("EMQX presence refresh unavailable")
            return PresenceSnapshot.unavailable()

    async def _fetch_snapshot(self) -> PresenceSnapshot:
        client_ids: set[str] = set()
        seen_client_ids: set[str] = set()
        expected_count: int | None = None
        async with httpx.AsyncClient(
            auth=httpx.BasicAuth(self._api_key, self._api_secret),
            timeout=2.0,
            transport=self._transport,
        ) as client:
            for page in range(1, self._max_pages + 1):
                response = await client.get(
                    f"{self._base_url}/api/v5/clients",
                    params={
                        "page": page,
                        "limit": self.PAGE_SIZE,
                        "conn_state": "connected",
                    },
                )
                response.raise_for_status()
                payload = response.json()
                data = payload["data"]
                meta = payload["meta"]
                if not isinstance(data, list) or not isinstance(meta, dict):
                    raise ValueError("Invalid EMQX clients response")
                has_next = meta.get("hasnext")
                if not isinstance(has_next, bool):
                    raise ValueError("Invalid EMQX pagination metadata")
                if "count" in meta:
                    count = meta["count"]
                    if (
                        not isinstance(count, int)
                        or isinstance(count, bool)
                        or count < 0
                    ):
                        raise ValueError("Invalid EMQX pagination count")
                    if expected_count is None:
                        expected_count = count
                    elif count != expected_count:
                        raise ValueError("EMQX pagination count changed")
                for field, expected in (("page", page), ("limit", self.PAGE_SIZE)):
                    if field in meta:
                        value = meta[field]
                        if (
                            not isinstance(value, int)
                            or isinstance(value, bool)
                            or value != expected
                        ):
                            raise ValueError("Invalid EMQX pagination metadata")
                for entry in data:
                    if not isinstance(entry, dict):
                        raise ValueError("Invalid EMQX client row")
                    client_id = entry.get("clientid")
                    connected = entry.get("connected")
                    if not isinstance(client_id, str) or not isinstance(connected, bool):
                        raise ValueError("Invalid EMQX client row")
                    if client_id in seen_client_ids:
                        raise ValueError("EMQX pagination repeated a client")
                    seen_client_ids.add(client_id)
                    if (
                        connected is True
                        and client_id != self._mqtt_client_id
                        and DeviceService.validate_serial(client_id)
                    ):
                        client_ids.add(DeviceService.normalize_serial(client_id))
                if not has_next:
                    if expected_count is not None and len(seen_client_ids) != expected_count:
                        raise ValueError("EMQX pagination count mismatch")
                    return PresenceSnapshot.available_with(client_ids)
                if not data:
                    raise ValueError("EMQX pagination did not advance")
        raise ValueError("EMQX pagination exceeded the configured bound")


_presence_client = EmqxPresenceClient(
    settings.EMQX_API_BASE_URL,
    settings.EMQX_API_KEY.get_secret_value() if settings.EMQX_API_KEY else None,
    settings.EMQX_API_SECRET.get_secret_value() if settings.EMQX_API_SECRET else None,
    settings.MQTT_CLIENT_ID,
)


def get_emqx_presence_client() -> EmqxPresenceClient:
    return _presence_client
