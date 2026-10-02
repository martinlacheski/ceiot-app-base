"""Catalog names are unique case-insensitively; every duplicate answers 409 in Spanish."""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.auth.models import User
from app.core.security import create_access_token, hash_password


@pytest.fixture(name="headers")
def headers_fixture(session: Session) -> dict[str, str]:
    user = User(
        email="catalog-admin@example.com",
        username="catalog_admin",
        password=hash_password("testpassword"),
        is_verified=True,
        permissions=[
            "location:read", "location:create", "location:update", "location:delete",
            "environment:read", "environment:create", "environment:update", "environment:delete",
        ],
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


def _post(client, headers, url, **json):
    return client.post(url, headers=headers, json=json)


def _assert_conflict(response, fragment: str):
    assert response.status_code == 409, response.text
    assert fragment in response.json()["detail"]


def test_country_duplicate_is_409_case_insensitive(client: TestClient, headers):
    assert _post(client, headers, "/api/location/countries", name="Argentina").status_code == 201
    _assert_conflict(_post(client, headers, "/api/location/countries", name="ARGENTINA"), "ya existe")


def test_country_rename_onto_existing_name_is_409(client: TestClient, headers):
    _post(client, headers, "/api/location/countries", name="Chile")
    other = _post(client, headers, "/api/location/countries", name="Peru").json()["id"]

    response = client.put(f"/api/location/countries/{other}", headers=headers, json={"name": "chile"})

    _assert_conflict(response, "ya existe")


def test_country_rename_onto_inactive_name_is_409_not_a_server_error(client: TestClient, headers):
    gone = _post(client, headers, "/api/location/countries", name="Uruguay").json()["id"]
    client.delete(f"/api/location/countries/{gone}", headers=headers)
    other = _post(client, headers, "/api/location/countries", name="Bolivia").json()["id"]

    response = client.put(f"/api/location/countries/{other}", headers=headers, json={"name": "URUGUAY"})

    _assert_conflict(response, "ya existe")


def test_state_name_is_unique_per_country_only(client: TestClient, headers):
    one = _post(client, headers, "/api/location/countries", name="Brasil").json()["id"]
    two = _post(client, headers, "/api/location/countries", name="Paraguay").json()["id"]

    assert _post(client, headers, "/api/location/states", name="Cordoba", country_id=one).status_code == 201
    _assert_conflict(
        _post(client, headers, "/api/location/states", name="cordoba", country_id=one), "ya existe"
    )
    assert _post(client, headers, "/api/location/states", name="Cordoba", country_id=two).status_code == 201


def test_city_name_is_unique_per_state_only(client: TestClient, headers):
    country = _post(client, headers, "/api/location/countries", name="Colombia").json()["id"]
    one = _post(client, headers, "/api/location/states", name="Antioquia", country_id=country).json()["id"]
    two = _post(client, headers, "/api/location/states", name="Cauca", country_id=country).json()["id"]

    assert _post(
        client, headers, "/api/location/cities", name="Popayan", postal_code="1", state_id=one
    ).status_code == 201
    _assert_conflict(
        _post(client, headers, "/api/location/cities", name="POPAYAN", postal_code="2", state_id=one),
        "ya existe",
    )
    assert _post(
        client, headers, "/api/location/cities", name="Popayan", postal_code="3", state_id=two
    ).status_code == 201


def test_environment_type_duplicate_is_409_on_create_and_update(client: TestClient, headers):
    assert _post(client, headers, "/api/environment/types/", name="Granja").status_code == 201
    _assert_conflict(_post(client, headers, "/api/environment/types/", name="GRANJA"), "ya existe")

    other = _post(client, headers, "/api/environment/types/", name="Vivero").json()["id"]
    response = client.put(f"/api/environment/types/{other}", headers=headers, json={"name": "granja"})
    _assert_conflict(response, "ya existe")
