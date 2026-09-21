import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, status

from app.api.auth.models import User
from app.api.device.device_type.models import (
    DeviceTypeCreate,
    DeviceTypeRead,
    DeviceTypeUpdate,
)
from app.api.device.device_type.repository import DeviceTypeRepository
from app.api.device.device_type.service import DeviceTypeService
from app.api.device.permissions import DevicePermissions
from app.core.dependencies import AuthedAsyncDBSession, PermissionChecker

router = APIRouter()


@router.post("", response_model=DeviceTypeRead, status_code=status.HTTP_201_CREATED)
async def create_device_type(
    payload: DeviceTypeCreate,
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker(DevicePermissions.CREATE)),
):
    service = DeviceTypeService(DeviceTypeRepository(db))
    return await service.create(payload)


@router.get("", response_model=dict)
async def get_all_device_types(
    db: AuthedAsyncDBSession,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=10000),
    is_active: Optional[bool] = Query(True),
    search: Optional[str] = Query(None),
    sort: Optional[str] = Query(None),
    current_user: User = Depends(PermissionChecker(DevicePermissions.READ)),
):
    service = DeviceTypeService(DeviceTypeRepository(db))
    return await service.get_all(page, per_page, is_active, search, sort)


@router.get("/{type_id}", response_model=DeviceTypeRead)
async def get_device_type_by_id(
    type_id: uuid.UUID,
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker(DevicePermissions.READ)),
):
    service = DeviceTypeService(DeviceTypeRepository(db))
    return await service.get_by_id(type_id)


@router.put("/{type_id}", response_model=DeviceTypeRead)
async def update_device_type(
    type_id: uuid.UUID,
    payload: DeviceTypeUpdate,
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker(DevicePermissions.UPDATE)),
):
    service = DeviceTypeService(DeviceTypeRepository(db))
    return await service.update(type_id, payload)


@router.delete("/{type_id}")
async def delete_device_type(
    type_id: uuid.UUID,
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker(DevicePermissions.DELETE)),
):
    service = DeviceTypeService(DeviceTypeRepository(db))
    return await service.delete(type_id)
