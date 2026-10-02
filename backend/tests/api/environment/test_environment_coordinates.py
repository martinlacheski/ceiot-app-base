"""Environment latitude/longitude are the source of truth; ``location`` is the legacy mirror."""

import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.api.environment.environment.models import (
    Environment,
    EnvironmentCreate,
    EnvironmentRead,
    EnvironmentUpdate,
)


def _environment(**overrides) -> Environment:
    values = {
        "name": "Coordinates env",
        "address": "Somewhere 1",
        "description": "d",
        "city_id": uuid.uuid4(),
        "type_id": uuid.uuid4(),
    }
    values.update(overrides)
    return Environment(**values)


def _save(session: Session, environment: Environment) -> Environment:
    session.add(environment)
    session.commit()
    session.refresh(environment)
    return environment


def test_legacy_location_string_populates_numeric_columns_on_insert(session: Session):
    env = _save(session, _environment(location="-34.6037,-58.3816"))

    assert (env.latitude, env.longitude) == (-34.6037, -58.3816)
    assert env.location == "-34.6037,-58.3816"


def test_numeric_coordinates_populate_the_legacy_location_mirror(session: Session):
    env = _save(session, _environment(latitude=-31.4, longitude=-64.18))

    assert env.location == "-31.4,-64.18"
    assert (env.latitude, env.longitude) == (-31.4, -64.18)


def test_explicit_coordinates_win_over_a_conflicting_location(session: Session):
    env = _save(session, _environment(location="10.5,20.5", latitude=-31.4, longitude=-64.18))

    assert (env.latitude, env.longitude) == (-31.4, -64.18)
    assert env.location == "-31.4,-64.18"


@pytest.mark.parametrize("location", ["Synthetic Interior", "95.5,10.5", ""])
def test_unparseable_location_leaves_coordinates_null(session: Session, location):
    env = _save(session, _environment(location=location))

    assert env.latitude is None and env.longitude is None


def test_updating_location_reparses_and_updating_coordinates_rewrites_location(session: Session):
    env = _save(session, _environment(location="-34.6,-58.4"))

    env.location = "-31.4,-64.18"
    _save(session, env)
    assert (env.latitude, env.longitude) == (-31.4, -64.18)

    env.latitude, env.longitude = -32.9, -60.6
    _save(session, env)
    assert env.location == "-32.9,-60.6"

    env.location = "not coordinates"
    _save(session, env)
    assert env.latitude is None and env.longitude is None


@pytest.mark.parametrize(
    "assignment",
    ["latitude = 91, longitude = 0", "latitude = 0, longitude = 181", "latitude = 10, longitude = NULL"],
)
def test_database_check_rejects_out_of_range_and_half_coordinates(session: Session, assignment):
    env = _save(session, _environment(location="x"))

    with pytest.raises(IntegrityError):
        session.execute(text(f"UPDATE environment SET {assignment} WHERE id = :id"), {"id": env.id.hex})
    session.rollback()


def test_lone_latitude_is_not_a_point_and_falls_back_to_location(session: Session):
    env = _environment(location="-34.6,-58.4")
    env.latitude = 10.0
    env.longitude = None
    _save(session, env)

    assert (env.latitude, env.longitude) == (-34.6, -58.4)


def test_create_dto_accepts_numeric_coordinates_without_location():
    dto = EnvironmentCreate.model_validate(
        {
            "name": "n", "address": "a", "description": "d",
            "cityId": str(uuid.uuid4()), "typeId": str(uuid.uuid4()),
            "latitude": -34.6, "longitude": -58.4,
        }
    )
    assert (dto.latitude, dto.longitude) == (-34.6, -58.4)


@pytest.mark.parametrize(
    "extra",
    [
        {"latitude": 91, "longitude": 0, "location": "x"},
        {"latitude": 0, "longitude": 181, "location": "x"},
        {"latitude": 10, "location": "x"},
        {},
    ],
)
def test_create_dto_rejects_invalid_or_missing_coordinates(extra):
    base = {
        "name": "n", "address": "a", "description": "d",
        "cityId": str(uuid.uuid4()), "typeId": str(uuid.uuid4()),
    }
    with pytest.raises(ValidationError):
        EnvironmentCreate.model_validate({**base, **extra})


def test_update_dto_requires_both_coordinates_together():
    assert EnvironmentUpdate.model_validate({"latitude": 1, "longitude": 2}).latitude == 1
    with pytest.raises(ValidationError):
        EnvironmentUpdate.model_validate({"latitude": 1})


def test_read_dto_exposes_coordinates_next_to_legacy_location():
    read = EnvironmentRead.model_validate(
        {
            "id": uuid.uuid4(), "name": "n", "address": "a", "location": "1.5,2.5",
            "latitude": 1.5, "longitude": 2.5, "description": "d",
            "city_id": uuid.uuid4(), "type_id": uuid.uuid4(),
            "is_active": True, "is_public_map_visible": False,
        }
    )
    dumped = read.model_dump(by_alias=True)
    assert dumped["latitude"] == 1.5 and dumped["longitude"] == 2.5
    assert dumped["location"] == "1.5,2.5"


def test_environment_api_round_trips_coordinates_and_legacy_location(client, session: Session):
    from app.api.auth.models import User
    from app.api.environment.environment_type.models import EnvironmentType
    from app.api.location.models import LocationCity, LocationCountry, LocationState
    from app.core.security import create_access_token, hash_password

    country = LocationCountry(name="Coord country")
    session.add(country)
    session.commit()
    state = LocationState(name="Coord state", country_id=country.id)
    session.add(state)
    session.commit()
    city = LocationCity(name="Coord city", postal_code="1", state_id=state.id)
    env_type = EnvironmentType(name="Coord type")
    user = User(
        email="coords@example.com", username="coords", password=hash_password("pw"), is_verified=True,
        permissions=["environment:create", "environment:update", "environment:read"],
    )
    session.add_all([city, env_type, user])
    session.commit()
    token, _ = create_access_token({"id": str(user.id)})
    headers = {"Authorization": f"Bearer {token}"}

    created = client.post(
        "/api/environment/",
        headers=headers,
        json={
            "name": "Granja", "address": "Ruta 9", "description": "d",
            "cityId": str(city.id), "typeId": str(env_type.id),
            "latitude": -31.4, "longitude": -64.18,
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["latitude"], body["longitude"]) == (-31.4, -64.18)
    assert body["location"] == "-31.4,-64.18"

    legacy_client_update = client.put(
        f"/api/environment/{body['id']}", headers=headers, json={"location": "-32.9,-60.6"}
    )
    assert legacy_client_update.status_code == 200, legacy_client_update.text
    assert (legacy_client_update.json()["latitude"], legacy_client_update.json()["longitude"]) == (-32.9, -60.6)

    invalid = client.put(f"/api/environment/{body['id']}", headers=headers, json={"latitude": 120, "longitude": 0})
    assert invalid.status_code == 422
