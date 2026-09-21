from typing import Literal, get_args, get_type_hints

import pytest

from app.api.environment.environment.repository import EnvironmentRepository
from app.api.environment.environment.router import get_all_environments


class StubSession:
    pass


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sort_by", "sort_order", "expected"),
    [
        ("name", "asc", "environment.name ASC, environment.id ASC"),
        ("status", "desc", "environment.is_active DESC, environment.id ASC"),
        ("type", "asc", "environmenttype.name ASC, environment.id ASC"),
        ("owner", "desc", '"user".username) DESC, environment.id ASC'),
    ],
)
async def test_get_all_applies_allowlisted_sort_before_pagination(
    monkeypatch, sort_by, sort_order, expected
):
    captured = {}

    async def capture_query(**kwargs):
        captured["query"] = kwargs["base_query"]
        captured["page"] = kwargs["page"]
        captured["per_page"] = kwargs["per_page"]
        return {"items": [], "total": 0, "pages": 0, "page": 2, "per_page": 5}

    monkeypatch.setattr(
        "app.api.environment.environment.repository.paginate_query_async",
        capture_query,
    )

    result = await EnvironmentRepository(StubSession()).get_all(
        page=2,
        per_page=5,
        is_active=True,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    sql = str(captured["query"])
    assert expected in sql
    assert "environment.is_active = true" in sql.lower()
    assert (captured["page"], captured["per_page"]) == (2, 5)
    assert result["page"] == 2


def test_environment_sort_query_parameters_are_strict_literals():
    hints = get_type_hints(get_all_environments)

    assert set(get_args(hints["sort_by"])) == {"name", "type", "owner", "status"}
    assert set(get_args(hints["sort_order"])) == {"asc", "desc"}
