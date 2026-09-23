from datetime import datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.api.device.device_type.constants import DEFAULT_DEVICE_TYPE_ID, DEFAULT_DEVICE_TYPE_NAME
from app.api.device.device_type.models import DeviceTypeCatalog
from app.api.device.models import Device
from app.api.device.device_type.repository import DeviceTypeRepository
from app.api.device.permissions import DevicePermissions
from app.api.device.service import DeviceService
from app.core.security import create_access_token, hash_password


def make_token(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


def create_device_admin(session: Session) -> User:
    existing = session.exec(
        select(User).where(User.username == "device_types_admin")
    ).first()
    if existing:
        return existing

    user = User(
        email="device-types@example.com",
        username="device_types_admin",
        password=hash_password("testpassword"),
        is_verified=True,
        permissions=[
            DevicePermissions.READ,
            DevicePermissions.READ_ALL,
            DevicePermissions.CREATE,
            DevicePermissions.UPDATE,
            DevicePermissions.DELETE,
        ],
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_default_device_type_bootstrap_assigns_read_only_code(async_engine, async_session: AsyncSession):
    async with async_engine.begin() as connection:
        await connection.run_sync(SQLModel.metadata.create_all)

    repo = DeviceTypeRepository(async_session)

    default_type = await repo.ensure_default_exists()

    assert default_type.code == "relay_1"


def test_device_type_catalog_crud_flow(client: TestClient, session: Session):
    user = create_device_admin(session)
    headers = {"Authorization": f"Bearer {make_token(user.id)}"}

    list_response = client.get("/api/devices/types", headers=headers)
    assert list_response.status_code == 200
    assert any(
        item["name"] == DEFAULT_DEVICE_TYPE_NAME and item["code"] == "relay_1"
        for item in list_response.json()["items"]
    )

    create_response = client.post(
        "/api/devices/types",
        headers=headers,
        json={"name": "2 Relés", "code": "expendedora"},
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"] == "2 Relés"
    assert created["isActive"] is True
    assert created["code"] is None

    get_response = client.get(f"/api/devices/types/{created['id']}", headers=headers)
    assert get_response.status_code == 200
    assert get_response.json()["name"] == "2 Relés"
    assert get_response.json()["code"] is None

    update_response = client.put(
        f"/api/devices/types/{created['id']}",
        headers=headers,
        json={"name": "2 Relés Plus", "code": "other"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "2 Relés Plus"
    assert update_response.json()["code"] is None

    delete_response = client.delete(f"/api/devices/types/{created['id']}", headers=headers)
    assert delete_response.status_code == 200

    stored = session.exec(
        select(DeviceTypeCatalog).where(DeviceTypeCatalog.id == UUID(created["id"]))
    ).first()
    assert stored is not None
    assert stored.is_active is False


def test_device_read_includes_nested_device_type_code(
    client: TestClient,
    session: Session,
):
    user = create_device_admin(session)
    headers = {"Authorization": f"Bearer {make_token(user.id)}"}
    serial = DeviceService.generate_serial()

    create_response = client.post(
        "/api/devices",
        headers=headers,
        json={
            "serial": serial,
            "name": "Nested Code Device",
            "deviceTypeId": str(DEFAULT_DEVICE_TYPE_ID),
        },
    )

    assert create_response.status_code == 200
    assert create_response.json()["type"]["code"] == "relay_1"

    get_response = client.get(f"/api/devices/{create_response.json()['id']}", headers=headers)
    assert get_response.status_code == 200
    assert get_response.json()["type"]["code"] == "relay_1"


def test_device_detail_includes_updated_at(
    client: TestClient,
    session: Session,
):
    user = create_device_admin(session)
    headers = {"Authorization": f"Bearer {make_token(user.id)}"}
    serial = DeviceService.generate_serial()
    updated_at = datetime(2026, 9, 23, 12, 34, 56)

    create_response = client.post(
        "/api/devices",
        headers=headers,
        json={
            "serial": serial,
            "name": "Updated At Device",
            "deviceTypeId": str(DEFAULT_DEVICE_TYPE_ID),
        },
    )
    assert create_response.status_code == 200

    device = session.get(Device, UUID(create_response.json()["id"]))
    assert device is not None
    device.updated_at = updated_at
    session.add(device)
    session.commit()

    get_response = client.get(
        f"/api/devices/{create_response.json()['id']}",
        headers=headers,
    )

    assert get_response.status_code == 200
    assert datetime.fromisoformat(get_response.json()["updatedAt"]) == updated_at


def test_device_type_create_rejects_duplicate_name_case_insensitively(
    client: TestClient,
    session: Session,
):
    user = create_device_admin(session)
    headers = {"Authorization": f"Bearer {make_token(user.id)}"}

    first_response = client.post(
        "/api/devices/types",
        headers=headers,
        json={"name": "Legacy Duplicate"},
    )
    assert first_response.status_code == 201

    duplicate_response = client.post(
        "/api/devices/types",
        headers=headers,
        json={"name": "legacy duplicate"},
    )

    assert duplicate_response.status_code == 400
    assert duplicate_response.json() == {
        "detail": "Device type with this name already exists"
    }


def test_device_type_list_defaults_to_active_only(
    client: TestClient,
    session: Session,
):
    user = create_device_admin(session)
    headers = {"Authorization": f"Bearer {make_token(user.id)}"}

    active_type = DeviceTypeCatalog(name="Active Router Default", is_active=True)
    inactive_type = DeviceTypeCatalog(name="Inactive Router Default", is_active=False)
    session.add(active_type)
    session.add(inactive_type)
    session.commit()

    response = client.get("/api/devices/types", headers=headers)

    assert response.status_code == 200
    returned_names = {item["name"] for item in response.json()["items"]}
    assert "Active Router Default" in returned_names
    assert "Inactive Router Default" not in returned_names
