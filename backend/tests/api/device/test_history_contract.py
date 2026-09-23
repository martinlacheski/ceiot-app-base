"""History API contract and pure filtering regressions (no database needed)."""

import uuid
from datetime import datetime, timezone

from app.api.device.history.service import _matches_search, _sorted_entries
from app.api.device.history.service import DeviceHistoryService, HistoryScope
from app.main import app


def test_history_routes_and_bounded_query_parameters():
    paths = app.openapi()["paths"]
    prefix = "/api/devices/history/devices"
    assert {prefix, f"{prefix}/{{serial}}/sensor-readings", f"{prefix}/{{serial}}/operations"} <= paths.keys()
    for route in (prefix, f"{prefix}/{{serial}}/sensor-readings", f"{prefix}/{{serial}}/operations"):
        params = {param["name"]: param for param in paths[route]["get"]["parameters"]}
        assert params["per_page"]["schema"]["maximum"] == 10000
        assert params["utc_offset_minutes"]["schema"]["minimum"] == -840
        assert params["utc_offset_minutes"]["schema"]["maximum"] == 840
        search_schema = params["search"]["schema"]
        assert any(part.get("maxLength") == 64 for part in search_schema.get("anyOf", [search_schema]))
    assert "owner_id" in {p["name"] for p in paths[prefix]["get"]["parameters"]}


def test_aggregate_search_and_nulls_last_sort():
    instant = datetime(2026, 9, 23, 12, 30, tzinfo=timezone.utc)
    entries = [
        {"serial": "B", "environment_id": "2", "environment_name": None,
         "device_name": None, "owner_name": None, "first_seen": instant,
         "last_seen": instant, "readings_count": 1, "operations_count": 0},
        {"serial": "A", "environment_id": "1", "environment_name": "Laboratorio",
         "device_name": None, "owner_name": "Ada", "first_seen": instant,
         "last_seen": instant, "readings_count": 2, "operations_count": 0},
    ]
    assert _matches_search(entries[1], "laboratorio", 0)
    assert _matches_search(entries[1], "24/09/2026", 840)
    assert [e["serial"] for e in _sorted_entries(entries, "environment_name", "desc")] == ["A", "B"]
    assert [e["serial"] for e in _sorted_entries(entries, "environment_name", "asc")] == ["A", "B"]


def test_history_http_validation_and_admin_owner_filter(client, token, test_user, session, monkeypatch):
    calls = []

    async def fake_list(self, user, **kwargs):
        calls.append(kwargs)
        return {"items": [], "total": 0, "page": kwargs["page"],
                "per_page": kwargs["per_page"], "pages": 0}

    monkeypatch.setattr(DeviceHistoryService, "list_devices", fake_list)
    headers = {"Authorization": f"Bearer {token}"}
    path = "/api/devices/history/devices"
    valid = client.get(path, params={"search": "  humid  ", "sort_by": "readings_count",
                                     "sort_order": "asc", "page": 2, "per_page": 10000}, headers=headers)
    assert valid.status_code == 200
    assert valid.json() == {"items": [], "total": 0, "page": 2, "perPage": 10000, "pages": 0}
    assert calls[-1]["search"] == "  humid  "
    assert calls[-1]["sort_by"] == "readings_count"
    assert client.get(path, params={"per_page": 10001}, headers=headers).status_code == 422
    assert client.get(path, params={"search": "x" * 65}, headers=headers).status_code == 422
    assert client.get(path, params={"utc_offset_minutes": 841}, headers=headers).status_code == 422
    assert client.get(path, params={"owner_id": str(test_user.id)}, headers=headers).status_code == 403
    test_user.is_admin = True
    session.add(test_user)
    session.commit()
    assert client.get(path, params={"owner_id": str(test_user.id)}, headers=headers).status_code == 200
    assert calls[-1]["owner_id"] == test_user.id


def test_history_detail_404_and_filters(client, token, monkeypatch):
    async def fake_scope(self, user):
        return HistoryScope()

    async def no_history(self, scope, serial, environment_id=None):
        return False

    monkeypatch.setattr(DeviceHistoryService, "resolve_scope", fake_scope)
    monkeypatch.setattr(DeviceHistoryService, "has_history", no_history)
    headers = {"Authorization": f"Bearer {token}"}
    for suffix in ("sensor-readings", "operations"):
        path = f"/api/devices/history/devices/NOT-OWNED/{suffix}"
        assert client.get(path, headers=headers).status_code == 404
        assert client.get(path, params={"per_page": 10001}, headers=headers).status_code == 422
        assert client.get(path, params={"sort_by": "invalid"}, headers=headers).status_code == 422


def test_history_detail_success_camel_case_and_filter_forwarding(client, token, monkeypatch):
    calls = {}
    now = datetime(2026, 9, 23, 12, 30, tzinfo=timezone.utc)
    reading_id, operation_id = uuid.uuid4(), uuid.uuid4()

    async def fake_scope(self, user):
        return HistoryScope()

    async def has_history(self, scope, serial, environment_id=None):
        return serial == "HISTORY-1"

    async def fake_readings(self, scope, **kwargs):
        calls["readings"] = kwargs
        return {"items": [{"id": reading_id, "time": now, "device_serial": "HISTORY-1",
                           "temperature_c": 23.5, "relative_humidity_pct": 61.0,
                           "pressure_hpa": 1013.2}],
                "total": 1, "page": kwargs["page"], "per_page": kwargs["per_page"], "pages": 1}

    async def fake_operations(self, scope, **kwargs):
        calls["operations"] = kwargs
        return {"items": [{"id": operation_id, "time": now, "device_serial": "HISTORY-1",
                           "operation_type": "SENSOR_DATA", "status": "success"}],
                "total": 1, "page": kwargs["page"], "per_page": kwargs["per_page"], "pages": 1}

    monkeypatch.setattr(DeviceHistoryService, "resolve_scope", fake_scope)
    monkeypatch.setattr(DeviceHistoryService, "has_history", has_history)
    monkeypatch.setattr(DeviceHistoryService, "list_sensor_readings", fake_readings)
    monkeypatch.setattr(DeviceHistoryService, "list_operations", fake_operations)
    headers = {"Authorization": f"Bearer {token}"}
    prefix = "/api/devices/history/devices/HISTORY-1"
    telemetry = client.get(f"{prefix}/sensor-readings", params={
        "temp_min": 20, "humidity_max": 70, "pressure_min": 1000,
        "sort_by": "relative_humidity_pct", "sort_order": "asc",
        "per_page": 1, "page": 2, "search": "  23.5  "}, headers=headers)
    assert telemetry.status_code == 200
    assert telemetry.json()["items"][0]["relativeHumidityPct"] == 61.0
    assert telemetry.json()["perPage"] == 1
    assert calls["readings"]["filters"].temp_min == 20
    assert calls["readings"]["filters"].humidity_max == 70
    assert calls["readings"]["sort_by"] == "relative_humidity_pct"

    operations = client.get(f"{prefix}/operations", params={
        "status": "success", "operation_type": "SENSOR_DATA", "search": "sensores",
        "sort_by": "operation_type", "sort_order": "asc", "per_page": 1}, headers=headers)
    assert operations.status_code == 200
    assert operations.json()["items"][0]["operationType"] == "SENSOR_DATA"
    assert calls["operations"]["status"].value == "success"
    assert calls["operations"]["operation_type"].value == "SENSOR_DATA"
    assert calls["operations"]["sort_by"] == "operation_type"
