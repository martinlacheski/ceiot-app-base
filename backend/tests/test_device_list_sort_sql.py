"""Database-free contract checks for device list ordering SQL."""

from typing import get_args, get_type_hints
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import postgresql

from app.api.device import repository as device_repository
from app.api.device import router as device_router
from app.api.device.repository import DeviceRepository


@pytest.mark.asyncio
@pytest.mark.parametrize("sort_by", ["environmentName", "owner"])
async def test_device_sort_uses_nulls_last_without_row_multiplying_join(
    monkeypatch, sort_by: str
):
    captured = {}

    async def capture_query(_session, _model, query, _page, _per_page):
        captured["query"] = query
        return {"items": [], "total": 0, "page": 1, "pages": 0}

    monkeypatch.setattr(device_repository, "paginate_query_async", capture_query)
    await DeviceRepository(AsyncMock()).get_all(sort_by=sort_by)
    sql = str(captured["query"].compile(dialect=postgresql.dialect()))

    assert "NULLS LAST" in sql
    assert "ORDER BY" in sql
    if sort_by == "owner":
        assert "min(" in sql.lower()
        assert "environmentuser" in sql.lower()
        assert "is_owner" in sql
        assert "is_active" in sql
        assert "LEFT OUTER JOIN environmentuser" not in sql
    else:
        assert "environment.name" in sql


def test_device_route_accepts_owner_and_environment_sort_keys():
    sort_keys = get_args(get_type_hints(device_router.get_devices)["sort_by"])
    assert {"environmentName", "owner"}.issubset(sort_keys)
