"""Regressions for normalization item 8: the backend compares and writes aware UTC datetimes.

With every column ``timestamptz`` (migration 0022), PostgreSQL returns aware values, so any
naive ``datetime.now()`` / ``utcnow()`` left in a comparison raises ``TypeError`` and any
naive write is a wall clock without a zone. These tests feed aware values the way PostgreSQL
returns them and check every write is aware UTC.
"""

import uuid
from datetime import UTC, date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.access.service import GuestAccessService
from app.api.auth.models import User
from app.api.auth.service import AuthService
from app.api.device.firmware.models import FirmwareRelease, FirmwareUpdate
from app.api.device.firmware.service import FirmwareService
from app.api.device.models import Device, DeviceStatus
from app.api.device.repository import DeviceRepository
from app.core.dependencies import _touch_last_seen
from app.core.mqtt.handlers import _parse_reported_at
from app.core.security import create_access_token

MINUS_3 = timezone(timedelta(hours=-3))


def _aware_utc(value: datetime | None) -> bool:
    return value is not None and value.tzinfo is not None and value.utcoffset() == timedelta(0)


class _Result:
    def __init__(self, value):
        self.value = value

    def first(self):
        return self.value


class _FakeSession:
    def __init__(self, *, first=None, get=None):
        self._first, self._get = first, get
        self.added = []

    async def exec(self, statement):
        return _Result(self._first)

    async def get(self, model, key):
        return self._get

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        pass


# --- last_seen throttle -------------------------------------------------------------------------

class _SeenRepo:
    def __init__(self):
        self.calls = []

    async def touch_seen(self, user_id, now, min_interval):
        self.calls.append(now)
        return True


@pytest.mark.asyncio
async def test_last_seen_throttle_compares_against_an_aware_stored_value():
    user = User(id=uuid.uuid4(), email="a@b.c", username="u", hashed_password="x",
                last_seen_at=datetime.now(UTC) - timedelta(minutes=1))
    repo = _SeenRepo()

    await _touch_last_seen(repo, user)
    assert repo.calls == []  # fresh: no write, and no naive/aware TypeError

    user.last_seen_at = datetime.now(UTC) - timedelta(minutes=16)
    await _touch_last_seen(repo, user)
    assert len(repo.calls) == 1 and _aware_utc(repo.calls[0])
    assert _aware_utc(user.last_seen_at)


@pytest.mark.asyncio
async def test_login_is_recorded_with_an_aware_utc_instant():
    calls = []

    class _Repo:
        async def touch_login(self, user_id, now):
            calls.append(now)

    service = AuthService.__new__(AuthService)
    service.repo = _Repo()
    await service.record_login(uuid.uuid4())
    assert len(calls) == 1 and _aware_utc(calls[0])


# --- firmware download expiry -------------------------------------------------------------------

class _Store:
    async def exists(self, key):
        return True


@pytest.mark.asyncio
async def test_firmware_download_expiry_compares_aware_values():
    release = FirmwareRelease(id=uuid.uuid4(), version="1.0.0", sha256="a" * 64, size=1,
                              storage_key="k")
    attempt = FirmwareUpdate(id=uuid.uuid4(), device_id=uuid.uuid4(), release_id=release.id,
                             download_token="t", download_expires_at=datetime.now(UTC) + timedelta(minutes=5))
    session = _FakeSession(first=attempt, get=release)

    assert await FirmwareService(session, _Store()).open_download("t") is release
    assert _aware_utc(attempt.downloaded_at)

    attempt.download_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert await FirmwareService(session, _Store()).open_download("t") is None


# --- guest access start -------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_guest_access_start_is_normalized_to_aware_utc():
    service = GuestAccessService(repository=None)

    assert _aware_utc(service._normalize_access_starts_at(None))
    local = datetime(2026, 10, 11, 0, 0, tzinfo=MINUS_3)
    assert service._normalize_access_starts_at(local) == datetime(2026, 10, 11, 3, 0, tzinfo=UTC)
    assert _aware_utc(service._normalize_access_starts_at(local))
    # A naive value keeps meaning a UTC wall clock.
    assert service._normalize_access_starts_at(datetime(2026, 10, 11, 3, 0)) == datetime(
        2026, 10, 11, 3, 0, tzinfo=UTC)
    assert service._normalize_access_starts_at(date(2026, 10, 11)) == datetime(2026, 10, 11, tzinfo=UTC)


# --- device runtime writes ----------------------------------------------------------------------

def test_reported_gps_time_is_parsed_as_aware_utc():
    assert _parse_reported_at("2026-10-11T09:00:00-03:00") == datetime(2026, 10, 11, 12, 0, tzinfo=UTC)
    assert _aware_utc(_parse_reported_at("2026-10-11T12:00:00Z"))
    assert _parse_reported_at("2026-10-11T12:00:00") == datetime(2026, 10, 11, 12, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_runtime_report_writes_aware_utc_timestamps():
    device = Device(id=uuid.uuid4(), serial="SER-1", name="d", status=DeviceStatus.PAIRED)
    session = _FakeSession()

    await DeviceRepository(session).register_runtime_report(device, gps_latitude=1.0, gps_longitude=2.0)

    assert _aware_utc(device.last_connection)
    assert _aware_utc(device.gps_updated_at)
    report = next(item for item in session.added if item is not device)
    assert _aware_utc(report.reported_at) and _aware_utc(report.created_at)


@pytest.mark.asyncio
async def test_broker_presence_writes_aware_utc_timestamps():
    device = Device(id=uuid.uuid4(), serial="SER-1", name="d")
    session = _FakeSession(first=device)

    await DeviceRepository(session).update_broker_presence("SER-1", True)

    assert _aware_utc(device.broker_status_updated_at) and _aware_utc(device.broker_connected_at)


@pytest.mark.asyncio
async def test_last_connection_touch_is_aware_utc():
    device = Device(id=uuid.uuid4(), serial="SER-1", name="d")
    session = _FakeSession(first=device)

    await DeviceRepository(session).update_last_connection(device.id)

    assert _aware_utc(device.last_connection)


# --- API output ---------------------------------------------------------------------------------

def _has_offset(value: str) -> bool:
    return value.endswith("Z") or value[-6] in "+-"


def test_api_serializes_timestamps_with_an_explicit_offset(client: TestClient, test_user: User):
    token, _ = create_access_token({"id": str(test_user.id)})
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    body = response.json()
    created = body.get("createdAt", body.get("created_at"))
    seen = body.get("lastSeenAt", body.get("last_seen_at"))
    assert created and _has_offset(created), created
    assert seen and _has_offset(seen), seen
    assert datetime.fromisoformat(created.replace("Z", "+00:00")).utcoffset() == timedelta(0)
