from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.auth.models import User
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.core.security import create_access_token


def make_token(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


def seed_owner_filter_graph(session: Session):
    country = LocationCountry(name="AR Owner Filter")
    session.add(country)
    session.commit()
    session.refresh(country)

    state = LocationState(name="CBA", country_id=country.id)
    session.add(state)
    session.commit()
    session.refresh(state)

    city = LocationCity(name="Cordoba", postal_code="5000", state_id=state.id)
    session.add(city)
    session.commit()
    session.refresh(city)

    env_type = EnvironmentType(name="Owner Filter Type")
    session.add(env_type)
    session.commit()
    session.refresh(env_type)

    owner_a = User(
        email="owner-a-envfilter@example.com", username="owner_a_envfilter", password="x"
    )
    owner_b = User(
        email="owner-b-envfilter@example.com", username="owner_b_envfilter", password="x"
    )
    admin = User(
        email="admin-envfilter@example.com",
        username="admin_envfilter",
        password="x",
        permissions=["environment:read_all"],
        is_admin=True,
    )
    session.add_all([owner_a, owner_b, admin])
    session.commit()
    session.refresh(owner_a)
    session.refresh(owner_b)
    session.refresh(admin)

    env_a = Environment(
        name="Owner A Env",
        address="Street A",
        location="Hall A",
        description="Env A",
        city_id=city.id,
        type_id=env_type.id,
    )
    env_b = Environment(
        name="Owner B Env",
        address="Street B",
        location="Hall B",
        description="Env B",
        city_id=city.id,
        type_id=env_type.id,
    )
    session.add(env_a)
    session.add(env_b)
    session.commit()
    session.refresh(env_a)
    session.refresh(env_b)

    session.add(
        EnvironmentUser(
            environment_id=env_a.id, user_id=owner_a.id, is_owner=True, is_active=True
        )
    )
    session.add(
        EnvironmentUser(
            environment_id=env_b.id, user_id=owner_b.id, is_owner=True, is_active=True
        )
    )
    # owner_a is a non-owner member (e.g. guest-like) of env_b: should NOT count as
    # "owner" for the strict owner_id filter, even though the existing user_id
    # filter (member/guest/owner) does include it.
    session.add(
        EnvironmentUser(
            environment_id=env_b.id, user_id=owner_a.id, is_owner=False, is_active=True
        )
    )
    session.commit()

    return {
        "owner_a": owner_a,
        "owner_b": owner_b,
        "admin": admin,
        "env_a": env_a,
        "env_b": env_b,
    }


def test_admin_owner_id_filters_strictly_by_owner(client: TestClient, session: Session):
    seed = seed_owner_filter_graph(session)

    response = client.get(
        "/api/environment/",
        params={"owner_id": str(seed["owner_a"].id), "per_page": 200},
        headers={"Authorization": f"Bearer {make_token(seed['admin'].id)}"},
    )

    assert response.status_code == 200
    env_ids = {item["id"] for item in response.json()["items"]}

    assert str(seed["env_a"].id) in env_ids
    assert str(seed["env_b"].id) not in env_ids


def test_user_id_filter_still_includes_non_owner_membership(
    client: TestClient, session: Session
):
    seed = seed_owner_filter_graph(session)

    response = client.get(
        "/api/environment/",
        params={"user_id": str(seed["owner_a"].id), "per_page": 200},
        headers={"Authorization": f"Bearer {make_token(seed['admin'].id)}"},
    )

    assert response.status_code == 200
    env_ids = {item["id"] for item in response.json()["items"]}

    assert str(seed["env_a"].id) in env_ids
    assert str(seed["env_b"].id) in env_ids


def test_non_admin_owner_id_filter_is_overridden_to_self(
    client: TestClient, session: Session
):
    """
    A non-admin (missing environment:read_all) who passes owner_id for another
    user must be silently overridden to their own id, exactly like the existing
    user_id enforcement in get_all_environments. The spoofed owner's environment
    must never leak, and the caller's own owned environment must still appear.
    """
    seed = seed_owner_filter_graph(session)

    spoofed_response = client.get(
        "/api/environment/",
        params={"owner_id": str(seed["owner_b"].id), "per_page": 200},
        headers={"Authorization": f"Bearer {make_token(seed['owner_a'].id)}"},
    )

    assert spoofed_response.status_code == 200
    env_ids = {item["id"] for item in spoofed_response.json()["items"]}

    assert str(seed["env_b"].id) not in env_ids
    assert str(seed["env_a"].id) in env_ids
