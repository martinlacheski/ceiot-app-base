"""The legacy "Other" device type is deactivated, not deleted, and never self-heals back active.

Existing devices of this type must keep resolving (read/list), while new assignments (create, or
switching an existing device's type) are rejected exactly like any other inactive catalog type.
"""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.api.device.device_type.constants import (
    DEFAULT_DEVICE_TYPE_CODE,
    DEFAULT_DEVICE_TYPE_ID,
    LEGACY_OTHER_DEVICE_TYPE_CODE,
    LEGACY_OTHER_DEVICE_TYPE_ID,
    LEGACY_OTHER_DEVICE_TYPE_NAME,
)
from app.api.device.device_type.repository import DeviceTypeRepository
from app.api.device.device_type.models import DeviceTypeCatalog
from app.api.device.models import Device, DeviceStatus
from app.api.device.permissions import DevicePermissions
from app.api.device.service import DeviceService
from app.core.security import create_access_token, hash_password


def make_token(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


def create_device_admin(session: Session) -> User:
    existing = session.exec(
        select(User).where(User.username == "legacy_other_admin")
    ).first()
    if existing:
        return existing

    user = User(
        email="legacy-other@example.com",
        username="legacy_other_admin",
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


async def _seed_inactive_other(async_session: AsyncSession) -> DeviceTypeCatalog:
    other = DeviceTypeCatalog(
        id=LEGACY_OTHER_DEVICE_TYPE_ID,
        name=LEGACY_OTHER_DEVICE_TYPE_NAME,
        code=LEGACY_OTHER_DEVICE_TYPE_CODE,
        is_active=False,
    )
    async_session.add(other)
    await async_session.commit()
    await async_session.refresh(other)
    return other


# --- Repository-level behavior ---


@pytest.mark.asyncio
async def test_resolve_catalog_type_require_active_returns_none_and_does_not_reactivate(
    async_engine, async_session: AsyncSession
):
    async with async_engine.begin() as connection:
        await connection.run_sync(SQLModel.metadata.create_all)

    await _seed_inactive_other(async_session)
    repo = DeviceTypeRepository(async_session)

    resolved = await repo.resolve_catalog_type(
        device_type_id=LEGACY_OTHER_DEVICE_TYPE_ID,
        require_active=True,
    )

    assert resolved is None

    still_inactive = await repo.get_by_id(LEGACY_OTHER_DEVICE_TYPE_ID)
    assert still_inactive is not None
    assert still_inactive.is_active is False


@pytest.mark.asyncio
async def test_resolve_catalog_type_allows_inactive_other_when_not_requiring_active(
    async_engine, async_session: AsyncSession
):
    async with async_engine.begin() as connection:
        await connection.run_sync(SQLModel.metadata.create_all)

    await _seed_inactive_other(async_session)
    repo = DeviceTypeRepository(async_session)

    resolved = await repo.resolve_catalog_type(
        device_type_id=LEGACY_OTHER_DEVICE_TYPE_ID,
        require_active=False,
    )

    assert resolved is not None
    assert resolved.id == LEGACY_OTHER_DEVICE_TYPE_ID
    assert resolved.is_active is False


@pytest.mark.asyncio
async def test_resolve_catalog_type_default_self_heal_still_works(
    async_engine, async_session: AsyncSession
):
    async with async_engine.begin() as connection:
        await connection.run_sync(SQLModel.metadata.create_all)

    repo = DeviceTypeRepository(async_session)

    default_resolved = await repo.resolve_catalog_type(
        device_type_id=DEFAULT_DEVICE_TYPE_ID,
        require_active=True,
    )

    assert default_resolved is not None
    assert default_resolved.code == DEFAULT_DEVICE_TYPE_CODE
    assert default_resolved.is_active is True


def test_ensure_legacy_other_exists_no_longer_exists_on_repository():
    assert not hasattr(DeviceTypeRepository, "ensure_legacy_other_exists")
    assert not hasattr(DeviceTypeRepository, "get_legacy_other")


# --- API-level behavior ---


def test_device_type_list_excludes_deactivated_other(client: TestClient, session: Session):
    other = DeviceTypeCatalog(
        id=LEGACY_OTHER_DEVICE_TYPE_ID,
        name=LEGACY_OTHER_DEVICE_TYPE_NAME,
        code=LEGACY_OTHER_DEVICE_TYPE_CODE,
        is_active=False,
    )
    session.add(other)
    session.commit()

    user = create_device_admin(session)
    headers = {"Authorization": f"Bearer {make_token(user.id)}"}

    response = client.get("/api/devices/types", headers=headers)

    assert response.status_code == 200
    returned_names = {item["name"] for item in response.json()["items"]}
    assert LEGACY_OTHER_DEVICE_TYPE_NAME not in returned_names


def test_create_device_with_deactivated_other_type_is_rejected(
    client: TestClient, session: Session
):
    other = DeviceTypeCatalog(
        id=LEGACY_OTHER_DEVICE_TYPE_ID,
        name=LEGACY_OTHER_DEVICE_TYPE_NAME,
        code=LEGACY_OTHER_DEVICE_TYPE_CODE,
        is_active=False,
    )
    session.add(other)
    session.commit()

    user = create_device_admin(session)
    headers = {"Authorization": f"Bearer {make_token(user.id)}"}

    response = client.post(
        "/api/devices",
        json={
            "serial": DeviceService.generate_serial(),
            "name": "Rejected Other Device",
            "deviceTypeId": str(LEGACY_OTHER_DEVICE_TYPE_ID),
        },
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid device type reference"}


def test_existing_device_of_deactivated_other_type_is_still_readable(
    client: TestClient, session: Session
):
    other = DeviceTypeCatalog(
        id=LEGACY_OTHER_DEVICE_TYPE_ID,
        name=LEGACY_OTHER_DEVICE_TYPE_NAME,
        code=LEGACY_OTHER_DEVICE_TYPE_CODE,
        is_active=False,
    )
    session.add(other)
    session.commit()

    user = create_device_admin(session)
    device = Device(
        serial=DeviceService.generate_serial(),
        name="Legacy Other Device",
        device_type_id=LEGACY_OTHER_DEVICE_TYPE_ID,
        status=DeviceStatus.NEW,
    )
    session.add(device)
    session.commit()
    session.refresh(device)

    headers = {"Authorization": f"Bearer {make_token(user.id)}"}

    get_response = client.get(f"/api/devices/{device.id}", headers=headers)

    assert get_response.status_code == 200
    payload = get_response.json()
    assert payload["deviceTypeId"] == str(LEGACY_OTHER_DEVICE_TYPE_ID)
    assert payload["type"]["id"] == str(LEGACY_OTHER_DEVICE_TYPE_ID)
    assert payload["type"]["name"] == LEGACY_OTHER_DEVICE_TYPE_NAME

    list_response = client.get(
        f"/api/devices?device_type_id={LEGACY_OTHER_DEVICE_TYPE_ID}",
        headers=headers,
    )
    assert list_response.status_code == 200
    returned_ids = {item["id"] for item in list_response.json()["items"]}
    assert str(device.id) in returned_ids
