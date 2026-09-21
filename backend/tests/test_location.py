import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from app.api.auth.models import User
from app.core.security import hash_password, create_access_token

@pytest.fixture(name="location_token")
def location_token_fixture(client: TestClient, session: Session):
    # Enable location permissions for a new test user
    username = "location_admin"
    email = "loc@example.com"
    
    # Clean up if exists
    existing = session.exec(select(User).where(User.username == username)).first()
    if existing:
        session.delete(existing)
        session.commit()

    user = User(
        email=email,
        username=username,
        password=hash_password("testpassword"),
        is_verified=True,
        permissions=[
            "location:read", "location:create", "location:update", "location:delete"
        ],
        first_name="Loc",
        last_name="Admin",
        identification_number="LOC123"
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    response = client.post(
        "/auth/login",
        data={
            "username": username,
            "password": "testpassword"
        }
    )
    return response.json()["access_token"]


def test_create_country(client: TestClient, location_token: str):
    response = client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "Argentina"}
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Argentina"
    assert "id" in data
    assert "is_active" not in data # response model shouldn't show it unless asked, but model has it. default read DTO usually doesn't have it? Let's check DTO. 
    # Actually models.py DTOs didn't have is_active, so it shouldn't be there.


def test_create_country_unauthorized(client: TestClient):
    response = client.post(
        "/location/countries",
        json={"name": "Brazil"}
    )
    assert response.status_code == 401


def test_create_country_duplicate(client: TestClient, location_token: str):
    # First creation
    client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "Chile"}
    )
    # Second creation (Duplicate)
    response = client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "Chile"} # Case sensitive check usually? No, we implemented lazy check? 
        # We implemented case INSENSITIVE check.
    )
    assert response.status_code == 400
    assert "ya existe" in response.json()["detail"] or "already exists" in response.json()["detail"]

    # Case insensitive check
    response = client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "chile"} 
    )
    assert response.status_code == 400


def test_get_countries(client: TestClient, location_token: str):
    # Ensure standard GET works
    response = client.get(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data


def test_update_country(client: TestClient, location_token: str):
    # Create
    create_res = client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "Peru"}
    )
    country_id = create_res.json()["id"]

    # Update
    response = client.put(
        f"/location/countries/{country_id}",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "Republic of Peru"}
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Republic of Peru"


def test_delete_country_logical(client: TestClient, location_token: str):
    # Create
    create_res = client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "To Delete"}
    )
    country_id = create_res.json()["id"]

    # Delete
    response = client.delete(
        f"/location/countries/{country_id}",
        headers={"Authorization": f"Bearer {location_token}"}
    )
    assert response.status_code == 200

    # Get should fail
    get_res = client.get(
        f"/location/countries/{country_id}",
        headers={"Authorization": f"Bearer {location_token}"}
    )
    assert get_res.status_code == 404

    # Re-create should now FAIL with 409 Conflict (Inactive Duplicate)
    create_again = client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "To Delete"}
    )
    assert create_again.status_code == 409
    assert create_again.json()["detail"]["code"] == "INACTIVE_DUPLICATE"
    assert "id" in create_again.json()["detail"]


def test_state_crud(client: TestClient, location_token: str):
    # Setup Country
    c_res = client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "US"}
    )
    country_id = c_res.json()["id"]

    # Create State
    s_res = client.post(
        "/location/states",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "California", "country_id": country_id}
    )
    assert s_res.status_code == 201
    state_id = s_res.json()["id"]

    # Get States
    list_res = client.get(
        f"/location/states?country_id={country_id}",
        headers={"Authorization": f"Bearer {location_token}"}
    )
    assert list_res.status_code == 200
    assert len(list_res.json()["items"]) >= 1

    # Update State
    upd_res = client.put(
        f"/location/states/{state_id}",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "CA"}
    )
    assert upd_res.status_code == 200
    assert upd_res.json()["name"] == "CA"

    # Delete State
    del_res = client.delete(
        f"/location/states/{state_id}",
        headers={"Authorization": f"Bearer {location_token}"}
    )
    assert del_res.status_code == 200


def test_city_crud(client: TestClient, location_token: str):
    # Setup Country & State
    c_res = client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "France"}
    )
    country_id = c_res.json()["id"]

    s_res = client.post(
        "/location/states",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "Île-de-France", "country_id": country_id}
    )
    state_id = s_res.json()["id"]

    # Create City
    ct_res = client.post(
        "/location/cities",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "Paris", "postal_code": "75000", "state_id": state_id}
    )
    assert ct_res.status_code == 201
    city_id = ct_res.json()["id"]

    # Get Cities
    list_res = client.get(
        f"/location/cities?state_id={state_id}",
        headers={"Authorization": f"Bearer {location_token}"}
    )
    assert list_res.status_code == 200
    assert any(item["name"] == "Paris" for item in list_res.json()["items"])

    # Update City
    upd_res = client.put(
        f"/location/cities/{city_id}",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"postal_code": "75001"}
    )
    assert upd_res.status_code == 200
    assert upd_res.json()["postal_code"] == "75001"

    # Delete City
    del_res = client.delete(
        f"/location/cities/{city_id}",
        headers={"Authorization": f"Bearer {location_token}"}
    )
    assert del_res.status_code == 200


def test_pagination_is_active_filter(client: TestClient, location_token: str):
    # 1. Create Active Country
    client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "Active One"}
    )

    # 2. Create Inactive Country (Create then Delete)
    del_res = client.post(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"},
        json={"name": "Inactive One"}
    )
    inactive_id = del_res.json()["id"]
    client.delete(
        f"/location/countries/{inactive_id}",
        headers={"Authorization": f"Bearer {location_token}"}
    )

    # 3. Fetch Default (Should be Active only)
    res_default = client.get(
        "/location/countries",
        headers={"Authorization": f"Bearer {location_token}"}
    )
    assert res_default.status_code == 200
    items_default = res_default.json()["items"]
    names_default = [item["name"] for item in items_default]
    assert "Active One" in names_default
    assert "Inactive One" not in names_default

    # 4. Fetch Active Explicitly
    res_active = client.get(
        "/location/countries?is_active=true",
        headers={"Authorization": f"Bearer {location_token}"}
    )
    assert res_active.status_code == 200
    items_active = res_active.json()["items"]
    names_active = [item["name"] for item in items_active]
    assert "Active One" in names_active
    assert "Inactive One" not in names_active

    # 5. Fetch Inactive Explicitly
    res_inactive = client.get(
        "/location/countries?is_active=false",
        headers={"Authorization": f"Bearer {location_token}"}
    )
    assert res_inactive.status_code == 200
    items_inactive = res_inactive.json()["items"]
    # The response model usually doesn't include is_active, but we check presence by name
    names_inactive = [item["name"] for item in items_inactive]
    assert "Inactive One" in names_inactive
    assert "Active One" not in names_inactive

