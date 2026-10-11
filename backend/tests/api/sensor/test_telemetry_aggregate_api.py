"""Contract of GET /devices/{id}/telemetry/aggregate: bucket choice, validation, access rules."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.api.router import router
from app.api.sensor_catalog.telemetry import AGGREGATE_BUCKETS, resolve_bucket
from app.core.security import create_access_token

MINUTE = 60
HOUR = 60 * MINUTE
DAY = 24 * HOUR


def _headers(user):
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


def test_aggregate_route_registered():
    assert "/devices/{device_id}/telemetry/aggregate" in {route.path for route in router.routes}


def test_standard_buckets_are_ordered_and_named():
    assert list(AGGREGATE_BUCKETS) == ["1m", "5m", "15m", "1h", "6h", "1d"]
    assert AGGREGATE_BUCKETS["15m"] == 15 * MINUTE and AGGREGATE_BUCKETS["1d"] == DAY


@pytest.mark.parametrize(("span", "max_points", "expected"), [
    (HOUR, 500, "1m"),
    (500 * MINUTE, 500, "1m"),  # exactly max_points one-minute buckets still fits
    (500 * MINUTE + 1, 500, "5m"),  # one second more needs a 501st bucket
    (DAY, 500, "5m"),
    (7 * DAY, 500, "1h"),
    (30 * DAY, 500, "6h"),
    (366 * DAY, 500, "1d"),
    (DAY, 24, "1h"),
    (DAY, 23, "6h"),
    (366 * DAY, 10, "1d"),  # nothing fits: the coarsest bucket
])
def test_auto_bucket_is_the_smallest_that_fits(span, max_points, expected):
    assert resolve_bucket("auto", span, max_points) == expected


def test_explicit_bucket_is_kept():
    assert resolve_bucket("15m", DAY, 500) == "15m"
    assert resolve_bucket("1d", HOUR, 500) == "1d"


@pytest.fixture
def reader(session, test_user):
    test_user.permissions = [*test_user.permissions, "telemetry:read"]
    session.add(test_user)
    session.commit()
    return test_user


@pytest.fixture
def captured(monkeypatch):
    """Skip the PostgreSQL-only SQL and record what the route asked for."""
    from app.api.sensor_catalog import router as module

    calls = []

    async def fake_aggregate(session, device_id, start, end, bucket_seconds, utc_offset_minutes=0,
                             access_start=None):
        calls.append({"start": start, "end": end, "bucket_seconds": bucket_seconds,
                      "utc_offset_minutes": utc_offset_minutes, "access_start": access_start})
        return []

    monkeypatch.setattr(module, "aggregate_telemetry", fake_aggregate)
    return calls


def _allow_access(monkeypatch, access_start=None):
    from app.api.sensor_catalog import router as module

    async def resolve(*args, **kwargs):
        return access_start

    monkeypatch.setattr(module, "_resolve_access_start", resolve)


def test_aggregate_validation(client, reader, captured, monkeypatch):
    _allow_access(monkeypatch)
    url = f"/api/devices/{uuid.uuid4()}/telemetry/aggregate"
    headers = _headers(reader)
    ok = {"start": "2026-01-01T00:00:00Z", "end": "2026-01-02T00:00:00Z"}
    assert client.get(url, params=ok).status_code == 401
    assert client.get(url, params={"start": ok["start"]}, headers=headers).status_code == 422
    assert client.get(url, params={**ok, "end": ok["start"]}, headers=headers).status_code == 422
    assert client.get(url, params={**ok, "start": "2026-01-03T00:00:00Z"}, headers=headers).status_code == 422
    too_long = {"start": "2025-01-01T00:00:00Z", "end": "2026-01-02T00:00:01Z"}
    assert client.get(url, params=too_long, headers=headers).status_code == 422
    assert client.get(url, params={**ok, "bucket": "10m"}, headers=headers).status_code == 422
    assert client.get(url, params={**ok, "utc_offset_minutes": 841}, headers=headers).status_code == 422
    assert client.get(url, params={**ok, "max_points": 0}, headers=headers).status_code == 422
    assert client.get(url, params={**ok, "max_points": 5001}, headers=headers).status_code == 422
    # An explicit fine bucket over a long range would return too many buckets.
    month = {"start": "2026-01-01T00:00:00Z", "end": "2026-02-01T00:00:00Z", "bucket": "1m"}
    assert client.get(url, params=month, headers=headers).status_code == 422
    assert captured == []


def test_aggregate_resolves_bucket_and_forwards_offset(client, reader, captured, monkeypatch):
    _allow_access(monkeypatch)
    url = f"/api/devices/{uuid.uuid4()}/telemetry/aggregate"
    response = client.get(url, params={"start": "2026-01-01T00:00:00Z", "end": "2026-01-08T00:00:00Z",
                                       "utc_offset_minutes": -180}, headers=_headers(reader))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["bucket"] == "1h"
    assert body["bucketSeconds"] == HOUR
    assert body["items"] == [] and body["sensors"] == []
    assert datetime.fromisoformat(body["start"]) == datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert datetime.fromisoformat(body["end"]) == datetime(2026, 1, 8, tzinfo=timezone.utc)
    assert captured[-1]["bucket_seconds"] == HOUR
    assert captured[-1]["utc_offset_minutes"] == -180
    assert captured[-1]["access_start"] is None

    explicit = client.get(url, params={"start": "2026-01-01T00:00:00Z", "end": "2026-01-02T00:00:00Z",
                                       "bucket": "15m"}, headers=_headers(reader))
    assert explicit.json()["bucket"] == "15m" and explicit.json()["bucketSeconds"] == 15 * MINUTE


def test_aggregate_clips_a_guest_to_the_access_start(client, reader, captured, monkeypatch):
    granted = datetime(2026, 1, 5, 12, tzinfo=timezone.utc)
    _allow_access(monkeypatch, granted)
    url = f"/api/devices/{uuid.uuid4()}/telemetry/aggregate"
    response = client.get(url, params={"start": "2026-01-01T00:00:00Z", "end": "2026-01-08T00:00:00Z"},
                          headers=_headers(reader))
    assert response.status_code == 200, response.text
    # The bucket follows the requested window; the data starts at the grant.
    assert response.json()["bucket"] == "1h"
    assert datetime.fromisoformat(response.json()["start"]) == granted
    assert captured[-1]["access_start"] == granted
    assert captured[-1]["start"] == granted

    # A window that ends before the grant has nothing visible.
    before = client.get(url, params={"start": "2026-01-01T00:00:00Z", "end": "2026-01-02T00:00:00Z"},
                        headers=_headers(reader))
    assert before.status_code == 200
    assert before.json()["items"] == []
    assert len(captured) == 1


def test_aggregate_requires_permission_and_device_access(client, session, test_user, captured, monkeypatch):
    from app.api.sensor_catalog import router as module

    url = f"/api/devices/{uuid.uuid4()}/telemetry/aggregate"
    params = {"start": "2026-01-01T00:00:00Z", "end": "2026-01-02T00:00:00Z"}
    _allow_access(monkeypatch)
    assert client.get(url, params=params, headers=_headers(test_user)).status_code == 403

    test_user.permissions = [*test_user.permissions, "telemetry:read"]
    session.add(test_user)
    session.commit()

    async def denied(*args, **kwargs):
        raise HTTPException(403, "No device access")

    monkeypatch.setattr(module, "_resolve_access_start", denied)
    assert client.get(url, params=params, headers=_headers(test_user)).status_code == 403
    assert captured == []


def test_aggregate_origin_is_local_midnight():
    from app.api.sensor_catalog.telemetry import bucket_origin

    # UTC-3: local midnight is 03:00 UTC.
    assert bucket_origin(-180) == datetime(2000, 1, 3, 3, tzinfo=timezone.utc)
    assert bucket_origin(0) == datetime(2000, 1, 3, tzinfo=timezone.utc)
    assert bucket_origin(330) == datetime(2000, 1, 3, tzinfo=timezone.utc) - timedelta(minutes=330)
