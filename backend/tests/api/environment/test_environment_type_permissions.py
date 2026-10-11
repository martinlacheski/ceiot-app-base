"""Environment types are a global catalog: standard users read it, only admins manage it.

Mirrors the Document Types pattern (``identification_type:*``). The ``/ensure`` endpoint
stays on ``environment:create`` because a standard user creating an establishment may
add a missing type on the fly.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.auth.models import User
from app.api.environment.environment_type.models import EnvironmentType
from app.core.permissions import ALL_PERMISSIONS, BASIC_PERMISSIONS, PERMISSIONS_TREE
from app.core.security import create_access_token, hash_password

BASE = "/api/environment/types"
MANAGE_CODES = ("environment_type:create", "environment_type:update", "environment_type:delete")


def _user(session: Session, permissions: list[str], *, is_admin: bool = False) -> User:
    suffix = uuid.uuid4().hex[:10]
    user = User(
        email=f"env-type-{suffix}@example.com",
        username=f"env_type_{suffix}",
        password=hash_password("testpassword"),
        is_verified=True,
        is_admin=is_admin,
        permissions=permissions,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _headers(user: User) -> dict[str, str]:
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


def _environment_type(session: Session, name: str) -> EnvironmentType:
    item = EnvironmentType(name=name)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def test_environment_types_group_lists_the_four_crud_codes():
    group = PERMISSIONS_TREE["ENVIRONMENT_TYPES"]
    assert group["label"] == "Tipos de Establecimientos"
    assert {item["value"]: item["label"] for item in group["items"]} == {
        "environment_type:read": "Ver Tipos de Establecimientos",
        "environment_type:create": "Crear Tipos de Establecimientos",
        "environment_type:update": "Editar Tipos de Establecimientos",
        "environment_type:delete": "Eliminar Tipos de Establecimientos",
    }


def test_only_environment_type_read_is_basic():
    assert "environment_type:read" in BASIC_PERMISSIONS
    for code in MANAGE_CODES:
        assert code in ALL_PERMISSIONS
        assert code not in BASIC_PERMISSIONS


def test_standard_user_can_read_but_not_manage_environment_types(
    client: TestClient, session: Session,
):
    user = _user(session, list(BASIC_PERMISSIONS))
    existing = _environment_type(session, "Tipo existente estandar")
    headers = _headers(user)

    assert client.get(f"{BASE}/", headers=headers).status_code == 200
    assert client.get(f"{BASE}/{existing.id}", headers=headers).status_code == 200

    assert client.post(f"{BASE}/", headers=headers, json={"name": "Nuevo tipo"}).status_code == 403
    assert client.put(
        f"{BASE}/{existing.id}", headers=headers, json={"name": "Renombrado"}
    ).status_code == 403
    assert client.delete(f"{BASE}/{existing.id}", headers=headers).status_code == 403


def test_standard_user_can_still_ensure_a_type_while_creating_an_establishment(
    client: TestClient, session: Session,
):
    user = _user(session, list(BASIC_PERMISSIONS))

    response = client.post(f"{BASE}/ensure", headers=_headers(user), json={"name": "Vivero"})

    assert response.status_code == 200
    assert response.json()["name"] == "Vivero"


def test_listing_requires_environment_type_read(client: TestClient, session: Session):
    user = _user(session, ["user:me"])

    assert client.get(f"{BASE}/", headers=_headers(user)).status_code == 403


def test_admin_with_environment_type_codes_manages_the_catalog(
    client: TestClient, session: Session,
):
    admin = _user(session, list(ALL_PERMISSIONS), is_admin=True)
    headers = _headers(admin)

    created = client.post(f"{BASE}/", headers=headers, json={"name": "Invernadero admin"})
    assert created.status_code == 201
    type_id = created.json()["id"]

    assert client.get(f"{BASE}/{type_id}", headers=headers).status_code == 200
    assert client.put(
        f"{BASE}/{type_id}", headers=headers, json={"name": "Invernadero editado"}
    ).status_code == 200
    assert client.delete(f"{BASE}/{type_id}", headers=headers).status_code in (200, 204)
