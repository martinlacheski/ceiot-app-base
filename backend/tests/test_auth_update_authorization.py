import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.auth.models import User
from app.core.security import create_access_token, hash_password


def _create_user(
    session: Session,
    *,
    username: str,
    permissions: list[str],
    is_admin: bool = False,
    is_active: bool = True,
    is_verified: bool = False,
) -> User:
    user = User(
        email=f"{username}@example.com",
        username=username,
        password=hash_password("OriginalPassword123!"),
        permissions=permissions,
        is_admin=is_admin,
        is_active=is_active,
        is_verified=is_verified,
        first_name="Original",
        last_name="Name",
        identification_number=f"ID-{username}",
        phone="111111",
        address="Original address",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _headers(user: User) -> dict[str, str]:
    token, _ = create_access_token(
        data={"id": str(user.id), "username": user.username}
    )
    return {"Authorization": f"Bearer {token}"}


def _reload(session: Session, user_id) -> User:
    session.expire_all()
    user = session.get(User, user_id)
    assert user is not None
    return user


def test_basic_user_can_update_own_profile_and_account_fields(
    client: TestClient, session: Session
):
    user = _create_user(session, username="profile-user", permissions=["user:me"])

    response = client.put(
        f"/api/auth/update/{user.id}",
        headers=_headers(user),
        json={
            "email": "updated-profile@example.com",
            "username": "updated-profile-user",
            "first_name": "Updated",
            "last_name": "Profile",
            "identification_number": "UPDATED-ID",
            "phone": "222222",
            "birth_date": "1990-01-02",
            "address": "Updated address",
        },
    )

    assert response.status_code == 200
    persisted = _reload(session, user.id)
    assert persisted.email == "updated-profile@example.com"
    assert persisted.username == "updated-profile-user"
    assert persisted.first_name == "Updated"
    assert persisted.last_name == "Profile"
    assert persisted.identification_number == "UPDATED-ID"
    assert persisted.phone == "222222"
    assert str(persisted.birth_date) == "1990-01-02"
    assert persisted.address == "Updated address"


@pytest.mark.parametrize(
    ("field", "value", "attribute"),
    [
        ("permissions", ["user:me", "user:update"], "permissions"),
        ("is_active", False, "is_active"),
        ("is_verified", True, "is_verified"),
        ("is_admin", True, "is_admin"),
        ("password", "weak", "password"),
    ],
)
def test_basic_user_cannot_update_own_privileged_fields(
    client: TestClient,
    session: Session,
    field: str,
    value,
    attribute: str,
):
    user = _create_user(session, username=f"blocked-{field}", permissions=["user:me"])
    original = getattr(user, attribute)
    if isinstance(original, list):
        original = list(original)

    response = client.put(
        f"/api/auth/update/{user.id}",
        headers=_headers(user),
        json={field: value},
    )

    assert response.status_code == 403
    assert getattr(_reload(session, user.id), attribute) == original


def test_non_admin_update_holder_can_change_another_users_active_state(
    client: TestClient, session: Session
):
    editor = _create_user(
        session,
        username="editor",
        permissions=["user:me", "user:update"],
    )
    target = _create_user(session, username="active-target", permissions=["user:me"])

    response = client.put(
        f"/api/auth/update/{target.id}",
        headers=_headers(editor),
        json={"is_active": False},
    )

    assert response.status_code == 200
    assert _reload(session, target.id).is_active is False


def test_non_admin_update_holder_cannot_change_admin_role(
    client: TestClient, session: Session
):
    editor = _create_user(
        session,
        username="role-editor",
        permissions=["user:me", "user:update"],
    )
    target = _create_user(session, username="role-target", permissions=["user:me"])

    response = client.put(
        f"/api/auth/update/{target.id}",
        headers=_headers(editor),
        json={"is_admin": True},
    )

    assert response.status_code == 403
    assert _reload(session, target.id).is_admin is False


def test_admin_can_promote_another_user(
    client: TestClient, session: Session
):
    admin = _create_user(
        session,
        username="admin-editor",
        permissions=["user:me", "user:update"],
        is_admin=True,
    )
    target = _create_user(session, username="admin-target", permissions=["user:me"])

    response = client.put(
        f"/api/auth/update/{target.id}",
        headers=_headers(admin),
        json={"is_admin": True},
    )

    assert response.status_code == 200
    assert _reload(session, target.id).is_admin is True
