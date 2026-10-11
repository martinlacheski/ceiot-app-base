"""Operation types use one casing convention end to end: lowercase snake_case values.

The database keeps storing member NAMES (SQLAlchemy's default for ``Enum``), so the
API contract is the values. Legacy uppercase filter values stay accepted.
"""

import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.device.history.service import DeviceHistoryService, HistoryScope
from app.api.device.operations.models import (
    DeviceOperation,
    DeviceOperationStatus,
    DeviceOperationType,
)
from app.core.time import utc_now
from tests.api.device.test_contextual_access_router import make_token, seed_context_graph


SNAKE_CASE = re.compile(r"^[a-z]+(?:_[a-z]+)*$")


def test_every_operation_type_value_is_lowercase_snake_case():
    for member in DeviceOperationType:
        assert SNAKE_CASE.match(member.value), member
        assert member.value == member.name.lower()


@pytest.mark.parametrize("raw", ["sensor_data", "SENSOR_DATA", "Sensor_Data"])
def test_operation_type_parses_case_insensitively(raw):
    assert DeviceOperationType(raw) is DeviceOperationType.SENSOR_DATA


def test_unknown_operation_type_is_still_rejected():
    with pytest.raises(ValueError):
        DeviceOperationType("not_a_type")


def _seed_keep_active(session: Session, device) -> None:
    session.add(
        DeviceOperation(
            device_id=device.id,
            device_serial=device.serial,
            operation_type=DeviceOperationType.KEEP_ACTIVE,
            status=DeviceOperationStatus.SUCCESS,
            time=utc_now() - timedelta(minutes=1),
        )
    )
    session.commit()


def test_operations_by_device_returns_lowercase_types(client: TestClient, session: Session):
    seed = seed_context_graph(session)
    _seed_keep_active(session, seed["device"])
    headers = {"Authorization": f"Bearer {make_token(seed['owner'].id)}"}

    response = client.get(f"/api/devices/operations/by-device/{seed['device'].id}", headers=headers)

    assert response.status_code == 200
    assert sorted(item["operation_type"] for item in response.json()["items"]) == [
        "keep_active",
        "sensor_data",
    ]


@pytest.mark.parametrize("raw", ["sensor_data", "SENSOR_DATA"])
def test_operations_by_device_filter_accepts_new_and_legacy_values(
    client: TestClient, session: Session, raw: str
):
    seed = seed_context_graph(session)
    _seed_keep_active(session, seed["device"])
    headers = {"Authorization": f"Bearer {make_token(seed['owner'].id)}"}

    response = client.get(
        f"/api/devices/operations/by-device/{seed['device'].id}",
        params={"operation_type": raw},
        headers=headers,
    )

    assert response.status_code == 200
    assert [item["operation_type"] for item in response.json()["items"]] == ["sensor_data"]


def test_operations_by_device_filter_rejects_unknown_values(client: TestClient, session: Session):
    seed = seed_context_graph(session)
    headers = {"Authorization": f"Bearer {make_token(seed['owner'].id)}"}

    response = client.get(
        f"/api/devices/operations/by-device/{seed['device'].id}",
        params={"operation_type": "bogus"},
        headers=headers,
    )

    assert response.status_code == 422


@pytest.mark.parametrize("raw", ["keep_active", "KEEP_ACTIVE"])
def test_history_operations_return_lowercase_and_accept_legacy_filters(
    client: TestClient, token: str, monkeypatch, raw: str
):
    calls = {}
    now = datetime(2026, 10, 11, 12, 0, tzinfo=timezone.utc)

    async def fake_scope(self, user):
        return HistoryScope()

    async def has_history(self, scope, serial, environment_id=None):
        return True

    async def fake_operations(self, scope, **kwargs):
        calls.update(kwargs)
        items = [
            DeviceOperation(id=uuid.uuid4(), time=now, device_serial="HISTORY-1",
                            operation_type=operation_type, status=DeviceOperationStatus.SUCCESS)
            for operation_type in (DeviceOperationType.KEEP_ACTIVE, DeviceOperationType.SENSOR_DATA)
        ]
        return {"items": items, "total": 2, "page": 1, "per_page": 20, "pages": 1}

    monkeypatch.setattr(DeviceHistoryService, "resolve_scope", fake_scope)
    monkeypatch.setattr(DeviceHistoryService, "has_history", has_history)
    monkeypatch.setattr(DeviceHistoryService, "list_operations", fake_operations)

    response = client.get(
        "/api/devices/history/devices/HISTORY-1/operations",
        params={"operation_type": raw},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert calls["operation_type"] is DeviceOperationType.KEEP_ACTIVE
    assert [item["operationType"] for item in response.json()["items"]] == [
        "keep_active",
        "sensor_data",
    ]
