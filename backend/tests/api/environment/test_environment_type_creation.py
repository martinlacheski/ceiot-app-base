from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.auth.models import User
from app.core.security import create_access_token, hash_password


def _create_environment_type_admin(session: Session) -> User:
    user = User(
        email="environment-type-admin@example.com",
        username="environment_type_admin",
        password=hash_password("testpassword"),
        is_verified=True,
        permissions=["environment:create"],
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _authorization_headers(user: User) -> dict[str, str]:
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


def test_create_environment_type_preserves_explicit_inactive_status(
    client: TestClient,
    session: Session,
):
    user = _create_environment_type_admin(session)

    response = client.post(
        "/api/environment/types/",
        headers=_authorization_headers(user),
        json={"name": "Inactive Environment Type", "is_active": False},
    )

    assert response.status_code == 201
    assert response.json()["isActive"] is False


def test_create_environment_type_defaults_to_active_when_status_is_omitted(
    client: TestClient,
    session: Session,
):
    user = _create_environment_type_admin(session)

    response = client.post(
        "/api/environment/types/",
        headers=_authorization_headers(user),
        json={"name": "Default Active Environment Type"},
    )

    assert response.status_code == 201
    assert response.json()["isActive"] is True
