from fastapi.testclient import TestClient
from sqlmodel import Session
from app.api.auth.models import User
from app.core.security import create_access_token


def test_register(client: TestClient, token: str):
    response = client.post(
        "/api/auth/create",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": "new@example.com",
            "username": "newuser",
            "password": "newpassword",
            "is_admin": False,
            "first_name": "New",
            "last_name": "User",
            "identification_number": "NEW123",
        }
    )
    print(response.json())
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "new@example.com"
    assert "defaultDvemCommissionRate" not in data
    assert "id" in data
    assert "password" not in data


def test_login(client: TestClient, test_user: User):
    response = client.post(
        "/api/auth/login",
        data={
            "username": test_user.username,
            "password": "testpassword"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert "first_name" in data
    assert "last_name" in data
    assert data["first_name"] == "Test"
    assert data["last_name"] == "User"


def test_get_all_users(client: TestClient, token: str):
    response = client.get(
        "/api/auth/",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert len(data["items"]) >= 1


def test_update_user(client: TestClient, token: str, test_user: User):
    response = client.put(
        f"/api/auth/update/{test_user.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "username": "newusername",
            "address": "Av. Siempre Viva 742",
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "newusername"
    assert data["email"] == "test@example.com"
    assert data["address"] == "Av. Siempre Viva 742"
    assert "defaultDvemCommissionRate" not in data
    assert data["updated_at"] is not None


def test_delete_user(client: TestClient, token: str, test_user: User):
    response = client.delete(
        f"/api/auth/delete/{test_user.id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200

    # Verify soft delete
    response = client.get(
        f"/api/auth/{test_user.id}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["is_active"] is False


def test_change_password(client: TestClient, token: str, test_user: User):
    # 1. Success case
    response = client.patch(
        "/api/auth/password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "old_password": "testpassword",
            "new_password": "NewPassword123!",
            "confirm_password": "NewPassword123!"
        }
    )
    assert response.status_code == 200
    # The endpoint returns the updated user, not a message
    data = response.json()
    assert "username" in data

    # 2. Failure: Wrong old password
    response = client.patch(
        "/api/auth/password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "old_password": "WrongPassword",
            "new_password": "NewPassword123!",
            "confirm_password": "NewPassword123!"
        }
    )
    assert response.status_code == 400
    assert "Contraseña anterior incorrecta" in response.json()["detail"]

    # 3. Failure: Password mismatch (though frontend handles this, backend assumes payload is valid per pydantic, logic might check it too or pydantic validator)
    # Checking if backend validates mismatch if pydantic model enforces it
    response = client.patch(
        "/api/auth/password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "old_password": "NewPassword123!",  # Current is now NewPassword123!
            "new_password": "AnotherPassword1!",
            "confirm_password": "MismatchPassword1!"
        }
    )
    # Depending on implementation, this might be 400 or 422. Assuming 400 for consistency if custom validation.
    # Note: If passing 'confirm_password' to backend, usually backend validates it.
    assert response.status_code in [400, 422]


def test_verify_reset_token(client: TestClient, test_user: User):
    # 1. Valid token
    token_data = {"sub": test_user.email, "type": "reset_password"}
    valid_token, _ = create_access_token(data=token_data)

    response = client.get(f"/api/auth/verify-reset-token/{valid_token}")
    assert response.status_code == 200
    assert response.json()["valid"] is True

    # 2. Invalid token type
    token_data_invalid = {"sub": test_user.email, "type": "access_token"}
    invalid_token, _ = create_access_token(data=token_data_invalid)

    response = client.get(f"/api/auth/verify-reset-token/{invalid_token}")
    assert response.status_code == 400
    assert "Token inválido" in response.json()["detail"]

    # 3. Invalid signature (garbage)
    response = client.get("/api/auth/verify-reset-token/invalidtokenstring")
    assert response.status_code == 400


def test_verify_email(client: TestClient, test_user: User):
    # 1. Valid token
    token_data = {"sub": test_user.email, "type": "verification"}
    valid_token, _ = create_access_token(data=token_data)

    response = client.get(f"/api/auth/verify-email?token={valid_token}")
    assert response.status_code == 200
    assert "verificado exitosamente" in response.json()["message"]

    # 2. Invalid token type
    token_data_invalid = {"sub": test_user.email, "type": "access_token"}
    invalid_token, _ = create_access_token(data=token_data_invalid)

    response = client.get(f"/api/auth/verify-email?token={invalid_token}")
    assert response.status_code == 400


def test_resend_verification(client: TestClient, session: Session):
    # Create unverified user
    from app.api.auth.models import User
    from app.core.security import hash_password

    unverified_user = User(
        email="unverified@example.com",
        username="unverified",
        password=hash_password("password"),
        is_verified=False,
        is_admin=False,
        permissions=[]
    )
    session.add(unverified_user)
    session.commit()

    response = client.post(
        "/api/auth/resend-verification",
        json={"identifier": "unverified@example.com"}
    )
    assert response.status_code == 200
    assert "reenviado" in response.json()["message"]


def test_forgot_password(client: TestClient, test_user: User):
    response = client.post(
        "/api/auth/forgot-password",
        json={"email": test_user.email}
    )
    assert response.status_code == 200
    assert "enviado un correo" in response.json()["message"]


def test_reset_password(client: TestClient, test_user: User):
    # 1. Create valid reset token
    token_data = {"sub": test_user.email, "type": "reset_password"}
    valid_token, _ = create_access_token(data=token_data)

    # 2. Successful reset
    response = client.post(
        "/api/auth/reset-password",
        json={
            "token": valid_token,
            "new_password": "NewResetPassword1!",
            "confirm_password": "NewResetPassword1!"
        }
    )
    assert response.status_code == 200
    assert "actualizada exitosamente" in response.json()["message"]

    # 3. Verify login works with new password
    login_res = client.post(
        "/api/auth/login",
        data={
            "username": test_user.username,
            "password": "NewResetPassword1!"
        }
    )
    assert login_res.status_code == 200

def test_register_reactivation(client: TestClient, token: str):
    # 1. Create a user
    email = "reactivate@example.com"
    username = "reactivate_user"
    client.post(
        "/api/auth/create",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": email,
            "username": username,
            "password": "password",
            "is_admin": False,
            "first_name": "Reactivate",
            "last_name": "User",
            "identification_number": "REACTIVATE123"
        }
    )
    
    # Get user id via search
    response = client.get(
        f"/api/auth/?search={username}",
        headers={"Authorization": f"Bearer {token}"}
    )
    user_id = response.json()["items"][0]["id"]

    # 2. Delete the user (Soft Delete)
    response = client.delete(
        f"/api/auth/delete/{user_id}",
         headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200

    # 3. Try to register again
    response = client.post(
        "/api/auth/create",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": email,
            "username": username,
            "password": "newpassword",
            "is_admin": False,
            "first_name": "Reactivate",
            "last_name": "User",
            "identification_number": "REACTIVATE123"
        }
    )
    
    # 4. Verify 409 Conflict
    assert response.status_code == 409
    data = response.json()
    assert data["detail"]["code"] == "INACTIVE_DUPLICATE"
    assert data["detail"]["id"] == user_id
