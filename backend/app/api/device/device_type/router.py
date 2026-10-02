import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.auth.models import User
from app.api.device.device_type.models import (
    DeviceTypeAdminRead,
    DeviceTypeCreate,
    DeviceTypeUpdate,
)
from app.api.device.device_type.repository import DeviceTypeRepository
from app.api.device.device_type.service import DeviceTypeService
from app.api.device.permissions import DevicePermissions
from app.core.dependencies import AuthedAsyncDBSession, CurrentUser, PermissionChecker
from app.core.utils import CamelModel

router = APIRouter()


class DeviceTypePage(CamelModel):
    items: list[DeviceTypeAdminRead]
    total: int
    page: int
    per_page: int
    pages: int


def _admin_write(user: CurrentUser) -> User:
    if not user.is_admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Solo un administrador puede gestionar los tipos de dispositivo"
        )
    return user


def _service(db: AuthedAsyncDBSession) -> DeviceTypeService:
    return DeviceTypeService(DeviceTypeRepository(db))


@router.post(
    "",
    response_model=DeviceTypeAdminRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_admin_write)],
)
async def create_device_type(payload: DeviceTypeCreate, db: AuthedAsyncDBSession):
    return await _service(db).create(payload)


@router.get(
    "",
    response_model=DeviceTypePage,
    dependencies=[Depends(PermissionChecker(DevicePermissions.READ))],
)
async def get_all_device_types(
    db: AuthedAsyncDBSession,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=10000),
    is_active: Optional[bool] = Query(None),
    include_inactive: bool = Query(False),
    search: Optional[str] = Query(None),
    sort: Optional[str] = Query(None),
    hardware_model: Optional[str] = Query(None),
    sensor_id: Optional[uuid.UUID] = Query(None),
):
    """Active types by default (the selectors rely on it); ``include_inactive`` lists all of them
    and an explicit ``is_active`` always wins."""
    if is_active is None and not include_inactive:
        is_active = True
    return await _service(db).get_all(
        page, per_page, is_active, search, sort, hardware_model, sensor_id
    )


@router.get(
    "/{type_id}",
    response_model=DeviceTypeAdminRead,
    dependencies=[Depends(PermissionChecker(DevicePermissions.READ))],
)
async def get_device_type_by_id(type_id: uuid.UUID, db: AuthedAsyncDBSession):
    return await _service(db).get_by_id(type_id)


@router.put(
    "/{type_id}",
    response_model=DeviceTypeAdminRead,
    dependencies=[Depends(_admin_write)],
)
async def update_device_type(
    type_id: uuid.UUID, payload: DeviceTypeUpdate, db: AuthedAsyncDBSession
):
    return await _service(db).update(type_id, payload)


@router.delete(
    "/{type_id}",
    response_model=DeviceTypeAdminRead,
    dependencies=[Depends(_admin_write)],
)
async def delete_device_type(type_id: uuid.UUID, db: AuthedAsyncDBSession):
    """Deactivate (never delete): devices keep pointing at the type."""
    return await _service(db).delete(type_id)
