import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from app.api.auth.models import User
from app.core.security import hash_password

@pytest.fixture(name="tax_token")
def tax_token_fixture(client: TestClient, session: Session):
    # Enable tax permissions for a new test user
    username = "tax_admin"
    email = "tax@example.com"
    
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
            "tax:read", "tax:create", "tax:update", "tax:delete"
        ],
        first_name="Tax",
        last_name="Admin",
        identification_number="TAX123"
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    response = client.post(
        "/api/auth/login",
        data={
            "username": username,
            "password": "testpassword"
        }
    )
    return response.json()["access_token"]


def test_identification_type_crud(client: TestClient, tax_token: str):
    # Create
    res = client.post(
        "/api/tax/identification-types",
        headers={"Authorization": f"Bearer {tax_token}"},
        json={"name": "DNI"}
    )
    assert res.status_code == 201
    item_id = res.json()["id"]
    assert res.json()["name"] == "DNI"

    # Get
    get_res = client.get(
        f"/api/tax/identification-types/{item_id}",
        headers={"Authorization": f"Bearer {tax_token}"}
    )
    assert get_res.status_code == 200
    assert get_res.json()["name"] == "DNI"

    # Update
    upd_res = client.put(
        f"/api/tax/identification-types/{item_id}",
        headers={"Authorization": f"Bearer {tax_token}"},
        json={"name": "DNI Updated"}
    )
    assert upd_res.status_code == 200
    assert upd_res.json()["name"] == "DNI Updated"

    # Delete
    del_res = client.delete(
        f"/api/tax/identification-types/{item_id}",
        headers={"Authorization": f"Bearer {tax_token}"}
    )
    assert del_res.status_code == 200

    # Logical delete: the record stays retrievable by id, marked inactive
    get_res_2 = client.get(
        f"/api/tax/identification-types/{item_id}",
        headers={"Authorization": f"Bearer {tax_token}"}
    )
    assert get_res_2.status_code == 200
    assert get_res_2.json()["is_active"] is False

def test_reactivation_conflict(client: TestClient, tax_token: str):
    # 1. Create Active
    client.post(
        "/api/tax/identification-types",
        headers={"Authorization": f"Bearer {tax_token}"},
        json={"name": "Pasaporte"}
    )

    # 2. Delete (Soft Delete)
    # Need ID first. Assuming unique name logic valid.
    # Actually let's fetch list to get ID or capture from create.
    # Let's verify standard unique check first (Active)
    dup = client.post(
        "/api/tax/identification-types",
        headers={"Authorization": f"Bearer {tax_token}"},
        json={"name": "Pasaporte"}
    )
    assert dup.status_code == 400 # Active duplicate

    # Now get ID
    list_res = client.get(
        "/api/tax/identification-types?is_active=true",
        headers={"Authorization": f"Bearer {tax_token}"}
    )
    item_id = next(i["id"] for i in list_res.json()["items"] if i["name"] == "Pasaporte")
    
    # Delete
    client.delete(
        f"/api/tax/identification-types/{item_id}",
        headers={"Authorization": f"Bearer {tax_token}"}
    )

    # 3. Create again (Inactive Duplicate) -> Should conflict 409
    conflict = client.post(
        "/api/tax/identification-types",
        headers={"Authorization": f"Bearer {tax_token}"},
        json={"name": "Pasaporte"}
    )
    assert conflict.status_code == 409
    detail = conflict.json()["detail"]
    assert detail["code"] == "INACTIVE_DUPLICATE"
    assert detail["id"] == item_id

def test_permissions(client: TestClient):
    # No auth
    res = client.get("/api/tax/identification-types")
    assert res.status_code == 401
