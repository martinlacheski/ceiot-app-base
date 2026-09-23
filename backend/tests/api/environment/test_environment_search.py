from fastapi.testclient import TestClient
import pytest
from sqlmodel import Session, select

from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.auth.models import User
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.core.security import create_access_token


def _token_for(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


def _add_location(
    session: Session,
    *,
    country_name: str,
    state_name: str,
    city_name: str,
) -> LocationCity:
    country = LocationCountry(name=country_name)
    session.add(country)
    session.commit()
    session.refresh(country)

    state = LocationState(name=state_name, country_id=country.id)
    session.add(state)
    session.commit()
    session.refresh(state)

    city = LocationCity(name=city_name, postal_code="5000", state_id=state.id)
    session.add(city)
    session.commit()
    session.refresh(city)
    return city


def _add_environment(
    session: Session,
    *,
    name: str,
    address: str,
    location: str,
    city_id,
    type_id,
    owner_id,
    is_active: bool = True,
) -> Environment:
    environment = Environment(
        name=name,
        address=address,
        location=location,
        description=f"Description for {name}",
        city_id=city_id,
        type_id=type_id,
        is_active=is_active,
    )
    session.add(environment)
    session.commit()
    session.refresh(environment)
    session.add(
        EnvironmentUser(
            environment_id=environment.id,
            user_id=owner_id,
            is_owner=True,
            is_active=True,
        )
    )
    session.commit()
    return environment


@pytest.fixture
def environment_search_graph(session: Session):
    admin = User(
        email="admin-environment-search@example.com",
        username="admin_environment_search",
        password="x",
        first_name="OwnerFirstNeedle",
        last_name="OwnerLastNeedle",
        permissions=["environment:read_all"],
        is_admin=True,
    )
    other_owner = User(
        email="other-environment-search@example.com",
        username="other_environment_search",
        password="x",
        first_name="Other",
        last_name="Owner",
    )
    username_owner = User(
        email="username-environment-search@example.com",
        username="OwnerLoginOnlyMarker",
        password="x",
        first_name="",
        last_name="",
    )
    guest = User(
        email="guest-environment-search@example.com",
        username="guest_environment_search",
        password="x",
        first_name="Guest",
        last_name="Viewer",
    )
    session.add_all([admin, other_owner, username_owner, guest])
    session.commit()
    for user in (admin, other_owner, username_owner, guest):
        session.refresh(user)

    target_city = _add_location(
        session,
        country_name="CountryNeedle",
        state_name="StateNeedle",
        city_name="CityNeedle",
    )
    other_city = _add_location(
        session,
        country_name="Other Country",
        state_name="Other State",
        city_name="Other City",
    )

    target_type = EnvironmentType(name="TypeNeedle")
    other_type = EnvironmentType(name="Other Type")
    session.add_all([target_type, other_type])
    session.commit()
    session.refresh(target_type)
    session.refresh(other_type)

    target = _add_environment(
        session,
        name="NameNeedle Establishment",
        address="AddressNeedle 123",
        location="LocationNeedle -31.4,-64.2",
        city_id=target_city.id,
        type_id=target_type.id,
        owner_id=admin.id,
        is_active=False,
    )
    username_target = _add_environment(
        session,
        name="Username fallback establishment",
        address="Unrelated address",
        location="Unrelated location",
        city_id=other_city.id,
        type_id=other_type.id,
        owner_id=username_owner.id,
    )
    _add_environment(
        session,
        name="Unrelated establishment",
        address="Another address",
        location="Another location",
        city_id=other_city.id,
        type_id=other_type.id,
        owner_id=other_owner.id,
    )
    session.add(
        ScopedGuestRelation(
            owner_user_id=admin.id,
            guest_user_id=guest.id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=target.id,
        )
    )
    session.commit()

    return {
        "headers": {"Authorization": f"Bearer {_token_for(admin.id)}"},
        "guest_headers": {"Authorization": f"Bearer {_token_for(guest.id)}"},
        "target_id": str(target.id),
        "username_target_id": str(username_target.id),
    }


@pytest.mark.parametrize(
    "search",
    [
        "nAmEnEeDlE",
        "tYpEnEeDlE",
        "oWnErFiRsTnEeDlE",
        "oWnErLaStNeEdLe",
        "aDdReSsNeEdLe",
        "lOcAtIoNnEeDlE",
        "cItYnEeDlE",
        "sTaTeNeEdLe",
        "cOuNtRyNeEdLe",
        "iNaCtIvO",
        "pRoPiEtArIo",
    ],
)
def test_environment_search_matches_each_visible_field_case_insensitively(
    client: TestClient,
    environment_search_graph,
    search: str,
):
    response = client.get(
        "/api/environment/",
        params={"search": search, "per_page": 100},
        headers=environment_search_graph["headers"],
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [
        environment_search_graph["target_id"]
    ]


def test_environment_search_uses_owner_username_when_display_name_is_empty(
    client: TestClient,
    environment_search_graph,
):
    response = client.get(
        "/api/environment/",
        params={"search": "oWnErLoGiNoNlYmArKeR", "per_page": 100},
        headers=environment_search_graph["headers"],
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [
        environment_search_graph["username_target_id"]
    ]


def test_environment_search_matches_displayed_owner_for_scoped_guest(
    client: TestClient,
    environment_search_graph,
):
    response = client.get(
        "/api/environment/",
        params={"search": "oWnErFiRsTnEeDlE", "per_page": 100},
        headers=environment_search_graph["guest_headers"],
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [
        environment_search_graph["target_id"]
    ]


def test_environment_search_returns_empty_page_for_no_match(
    client: TestClient,
    environment_search_graph,
):
    response = client.get(
        "/api/environment/",
        params={"search": "definitely-not-present", "per_page": 100},
        headers=environment_search_graph["headers"],
    )

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


def test_environment_search_is_applied_before_pagination(
    client: TestClient,
    session: Session,
    environment_search_graph,
):
    graph = environment_search_graph
    admin_id = next(
        user.id
        for user in session.exec(select(User)).all()
        if user.username == "admin_environment_search"
    )
    city_id = next(
        city.id
        for city in session.exec(select(LocationCity)).all()
        if city.name == "Other City"
    )
    type_id = next(
        environment_type.id
        for environment_type in session.exec(select(EnvironmentType)).all()
        if environment_type.name == "Other Type"
    )
    for suffix in ("A", "B", "C"):
        _add_environment(
            session,
            name=f"PageNeedle {suffix}",
            address=f"Pagination street {suffix}",
            location=f"Pagination location {suffix}",
            city_id=city_id,
            type_id=type_id,
            owner_id=admin_id,
        )

    response = client.get(
        "/api/environment/",
        params={
            "search": "pAgEnEeDlE",
            "page": 2,
            "per_page": 1,
            "sort_by": "name",
            "sort_order": "asc",
        },
        headers=graph["headers"],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert body["page"] == 2
    assert body["per_page"] == 1
    assert [item["name"] for item in body["items"]] == ["PageNeedle B"]
