"""Fixtures for the documents API tests: admin auth and an in-memory object store."""

import hashlib
from typing import AsyncIterator, BinaryIO

import pytest

from app.core.security import create_access_token
from app.core.storage import StorageUnavailable, get_storage
from app.main import app


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.fail = False

    def _check(self) -> None:
        if self.fail:
            raise StorageUnavailable("simulated outage")

    async def put(self, key: str, fileobj: BinaryIO, *, content_type: str, sha256: str, size: int) -> None:
        self._check()
        data = fileobj.read()
        assert hashlib.sha256(data).hexdigest() == sha256
        assert len(data) == size
        self.objects[key] = data

    async def exists(self, key: str) -> bool:
        self._check()
        return key in self.objects

    async def stream(self, key: str) -> AsyncIterator[bytes]:
        self._check()
        data = self.objects[key]
        for start in range(0, len(data), 4):
            yield data[start : start + 4]

    async def delete(self, key: str) -> None:
        self._check()
        self.objects.pop(key, None)


@pytest.fixture(name="storage")
def storage_fixture(client):
    storage = MemoryStorage()
    app.dependency_overrides[get_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_storage, None)


def _headers(user):
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(name="admin_headers")
def admin_headers_fixture(admin_user):
    return _headers(admin_user)


@pytest.fixture(name="user_headers")
def user_headers_fixture(test_user):
    return _headers(test_user)
