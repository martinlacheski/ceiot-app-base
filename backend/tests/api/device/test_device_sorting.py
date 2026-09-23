from typing import get_args, get_type_hints

import pytest
from fastapi.testclient import TestClient

from app.api.device.repository import DeviceRepository
from app.api.device.router import get_devices
from app.api.auth.models import User
from app.core.security import create_access_token


class StubSession:
    pass


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sort_by", "sort_order", "expected"),
    [
        ("name", "asc", "device.name ASC, device.id ASC"),
        ("serial", "desc", "device.serial DESC, device.id ASC"),
        ("enabled", "asc", "device.enabled ASC, device.id ASC"),
        ("deviceTypeName", "asc", "device_type.name ASC NULLS LAST, device.id ASC"),
    ],
)
async def test_get_all_applies_allowlisted_sort_before_pagination(
    monkeypatch, sort_by, sort_order, expected
):
    captured = {}

    async def capture_query(session, model, query, page, per_page):
        captured.update(query=query, page=page, per_page=per_page)
        return {"items": [], "total": 0, "pages": 0, "page": page, "per_page": per_page}

    monkeypatch.setattr("app.api.device.repository.paginate_query_async", capture_query)

    result = await DeviceRepository(StubSession()).get_all(
        page=2,
        per_page=5,
        is_active=True,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    sql = str(captured["query"])
    assert expected in sql
    assert "device.is_active = true" in sql.lower()
    assert (captured["page"], captured["per_page"]) == (2, 5)
    assert result["page"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("sort_by", ["model", "manufactureDate", "lastConnection"])
async def test_nullable_sorts_put_nulls_last_in_both_directions(monkeypatch, sort_by):
    queries = []

    async def capture_query(session, model, query, page, per_page):
        queries.append(str(query))
        return {"items": [], "total": 0, "pages": 0, "page": page, "per_page": per_page}

    monkeypatch.setattr("app.api.device.repository.paginate_query_async", capture_query)
    repository = DeviceRepository(StubSession())

    await repository.get_all(sort_by=sort_by, sort_order="asc")
    await repository.get_all(sort_by=sort_by, sort_order="desc")

    assert all("NULLS LAST, device.id ASC" in query for query in queries)


@pytest.mark.asyncio
async def test_live_presence_sort_uses_sql_before_pagination(monkeypatch):
    captured = {}

    async def capture_query(session, model, query, page, per_page):
        captured["query"] = str(query)
        return {"items": [], "total": 0, "pages": 0, "page": page, "per_page": per_page}

    monkeypatch.setattr("app.api.device.repository.paginate_query_async", capture_query)
    await DeviceRepository(StubSession()).get_all(
        sort_by="brokerConnected",
        sort_order="desc",
        connected_serials=frozenset({"IOT-0000-0001"}),
    )

    sql = captured["query"]
    order_by_clause = sql.split("ORDER BY", 1)[1]
    assert "CASE WHEN" in order_by_clause
    assert "device.serial IN" in order_by_clause
    assert "DESC, device.id ASC" in order_by_clause
    # The stale persisted flag is still a selected column (existing DTO
    # shape), it just must not drive the sort itself.
    assert "device.broker_connected" not in order_by_clause


@pytest.mark.asyncio
async def test_device_type_sort_reuses_the_search_join(monkeypatch):
    captured = {}

    async def capture_query(session, model, query, page, per_page):
        captured["sql"] = str(query)
        return {"items": [], "total": 0, "pages": 0, "page": page, "per_page": per_page}

    monkeypatch.setattr("app.api.device.repository.paginate_query_async", capture_query)
    await DeviceRepository(StubSession()).get_all(
        search="water", sort_by="deviceTypeName", sort_order="desc"
    )

    assert captured["sql"].count("JOIN device_type") == 1
    assert "device_type.name DESC NULLS LAST, device.id ASC" in captured["sql"]


def test_device_sort_query_parameters_are_strict_literals():
    hints = get_type_hints(get_devices)

    assert set(get_args(hints["sort_by"])) == {
        "name",
        "serial",
        "model",
        "manufactureDate",
        "status",
        "enabled",
        "isActive",
        "lastConnection",
        "brokerConnected",
        "deviceTypeName",
        "environmentName",
        "owner",
    }
    assert set(get_args(hints["sort_order"])) == {"asc", "desc"}


@pytest.mark.parametrize(
    "query",
    ["sort_by=unsafe", "sort_order=sideways"],
)
def test_device_sort_query_parameters_reject_invalid_values(
    client: TestClient, test_user: User, query: str
):
    token, _ = create_access_token({"id": str(test_user.id)})
    response = client.get(
        f"/api/devices?{query}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422
