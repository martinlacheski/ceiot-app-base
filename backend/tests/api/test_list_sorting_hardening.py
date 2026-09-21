from collections.abc import Callable

import pytest
from fastapi import HTTPException

from app.api.auth.repository import UserRepository
from app.api.auth.router import get_all_users
from app.api.location.repository import LocationRepository
from app.api.location.router import (
    get_all_cities,
    get_all_countries,
    get_all_states,
)
from app.core.sorting import parse_sort


class StubSession:
    pass


@pytest.mark.parametrize(
    "value",
    [
        "", "name", "name:", ":asc", "name:ASC", "name:sideways",
        "unknown:asc", "name:asc,", "name:asc,name:desc",
        "name:asc,alias:desc", " name:asc", "name:asc ",
        "name:asc:desc", "name:asc,active:asc,other:asc",
    ],
)
def test_sort_parser_rejects_invalid_values(value):
    with pytest.raises(HTTPException) as exc_info:
        parse_sort(
            value,
            {"name": "name", "alias": "name", "active": "active"},
            max_fields=2,
        )

    assert exc_info.value.status_code == 422


def test_sort_parser_normalizes_legacy_aliases_and_supports_multiple_fields():
    assert parse_sort(
        "country_name:desc,is_active:asc",
        {"country_name": "countryName", "is_active": "isActive"},
        max_fields=2,
    ) == (("countryName", "desc"), ("isActive", "asc"))

    assert parse_sort(
        "provincia:asc,pais:desc",
        {"provincia": "stateName", "pais": "countryName"},
        max_fields=2,
    ) == (("stateName", "asc"), ("countryName", "desc"))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("endpoint", "kwargs"),
    [
        (get_all_users, {"sort": "unknown:asc"}),
        (get_all_countries, {"sort": "name"}),
        (get_all_states, {"sort": "name:asc,name:desc"}),
        (
            get_all_cities,
            {"sort": "name:asc,stateName:desc,countryName:asc,postalCode:desc,isActive:asc,extra:asc"},
        ),
    ],
)
async def test_list_routers_reject_invalid_sort_before_repository(endpoint, kwargs):
    with pytest.raises(HTTPException) as exc_info:
        await endpoint(db=StubSession(), **kwargs)

    assert exc_info.value.status_code == 422


async def _capture_query(monkeypatch, target: str, call: Callable):
    captured = {}

    async def capture(**kwargs):
        captured.update(kwargs)
        return {
            "items": [], "total": 0, "pages": 0,
            "page": kwargs["page"], "per_page": kwargs["per_page"],
        }

    monkeypatch.setattr(target, capture)
    await call()
    return str(captured["base_query"])


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sort", "expected"),
    [
        ((("username", "asc"),), 'lower("user".username) ASC, "user".id ASC'),
        ((("email", "desc"),), 'lower("user".email) DESC, "user".id DESC'),
        ((("isActive", "asc"),), '"user".is_active ASC, "user".id ASC'),
        ((("isAdmin", "desc"),), '"user".is_admin DESC, "user".id DESC'),
        ((("createdAt", "asc"),), '"user".created_at ASC, "user".id ASC'),
        (
            (("lastName", "asc"), ("firstName", "desc")),
            'lower("user".last_name) ASC NULLS LAST, '
            'lower("user".first_name) DESC NULLS LAST, "user".id DESC',
        ),
    ],
)
async def test_user_sorting_is_multi_column_and_deterministic(monkeypatch, sort, expected):
    sql = await _capture_query(
        monkeypatch,
        "app.services.pagination.paginate_query_async",
        lambda: UserRepository(StubSession()).get_all(
            page=2, per_page=3, is_active=True, is_admin=False, sort=sort,
        ),
    )

    assert expected in sql
    assert '"user".is_active = true' in sql.lower()
    assert '"user".is_admin = false' in sql.lower()


@pytest.mark.asyncio
async def test_user_default_is_created_at_desc_with_id_tie_break(monkeypatch):
    sql = await _capture_query(
        monkeypatch,
        "app.services.pagination.paginate_query_async",
        lambda: UserRepository(StubSession()).get_all(),
    )
    assert '"user".created_at DESC, "user".id DESC' in sql


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "sort", "expected"),
    [
        ("get_all_countries", (("name", "desc"),), "lower(locationcountry.name) DESC, locationcountry.id DESC"),
        ("get_all_countries", (("isActive", "asc"),), "locationcountry.is_active ASC, locationcountry.id ASC"),
        ("get_all_states", (("name", "asc"),), "lower(locationstate.name) ASC, locationstate.id ASC"),
        ("get_all_states", (("countryName", "desc"),), "lower(locationcountry.name) DESC, locationstate.id DESC"),
        ("get_all_cities", (("stateName", "asc"),), "lower(locationstate.name) ASC, locationcity.id ASC"),
        ("get_all_cities", (("countryName", "desc"),), "lower(locationcountry.name) DESC, locationcity.id DESC"),
        ("get_all_cities", (("postalCode", "asc"),), "lower(locationcity.postal_code) ASC NULLS LAST, locationcity.id ASC"),
        ("get_all_cities", (("isActive", "desc"),), "locationcity.is_active DESC, locationcity.id DESC"),
        (
            "get_all_cities",
            (("countryName", "asc"), ("stateName", "desc"), ("name", "asc")),
            "lower(locationcountry.name) ASC, lower(locationstate.name) DESC, lower(locationcity.name) ASC, locationcity.id ASC",
        ),
    ],
)
async def test_location_sorting_supports_relations_and_nulls(monkeypatch, method, sort, expected):
    repository = LocationRepository(StubSession())
    sql = await _capture_query(
        monkeypatch,
        "app.services.pagination.paginate_query_async",
        lambda: getattr(repository, method)(sort=sort),
    )
    assert expected in sql


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["get_all_countries", "get_all_states", "get_all_cities"])
async def test_location_defaults_are_name_asc_with_id_tie_break(monkeypatch, method):
    repository = LocationRepository(StubSession())
    sql = await _capture_query(
        monkeypatch,
        "app.services.pagination.paginate_query_async",
        lambda: getattr(repository, method)(),
    )
    assert "name) ASC" in sql
    assert ".id ASC" in sql
