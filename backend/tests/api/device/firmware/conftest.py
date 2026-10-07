"""Fixtures of the firmware (OTA) tests: in-memory object storage, captured MQTT publishes and the
system session the MQTT handlers open."""

import hashlib
from typing import AsyncIterator, BinaryIO

import pytest

from app.api.device.firmware import mqtt_handlers
from app.core.config import settings
from app.core.mqtt import handlers as core_handlers
from app.core.storage import get_storage
from app.main import app
from tests.api.device.firmware.support import DOWNLOAD_BASE, fake_system_session


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, fileobj: BinaryIO, *, content_type: str, sha256: str, size: int) -> None:
        data = fileobj.read()
        assert hashlib.sha256(data).hexdigest() == sha256 and len(data) == size
        self.objects[key] = data

    async def exists(self, key: str) -> bool:
        return key in self.objects

    async def stream(self, key: str) -> AsyncIterator[bytes]:
        data = self.objects[key]
        for start in range(0, len(data), 1024):
            yield data[start : start + 1024]

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)


@pytest.fixture(name="storage")
def storage_fixture(client, monkeypatch: pytest.MonkeyPatch) -> MemoryStorage:
    storage = MemoryStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    monkeypatch.setattr(mqtt_handlers, "get_storage", lambda: storage)
    yield storage
    app.dependency_overrides.pop(get_storage, None)


@pytest.fixture(name="published")
def published_fixture(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    calls: list[tuple] = []
    monkeypatch.setattr(
        "app.core.mqtt.client.mqtt_client.publish",
        lambda topic, payload, qos=0, **kw: calls.append((topic, payload, qos)),
    )
    return calls


@pytest.fixture(name="system_sessions")
def system_sessions_fixture(monkeypatch: pytest.MonkeyPatch, async_engine):
    """The MQTT handlers open `system_session()`; in tests it is a session on the SQLite file."""
    factory = fake_system_session(async_engine)
    monkeypatch.setattr(mqtt_handlers, "system_session", factory)
    monkeypatch.setattr(core_handlers, "system_session", factory)


@pytest.fixture(autouse=True)
def firmware_download_base(monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setattr(settings, "FIRMWARE_DOWNLOAD_BASE_URL", DOWNLOAD_BASE, raising=False)
    return DOWNLOAD_BASE
