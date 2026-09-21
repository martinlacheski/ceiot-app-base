from fastapi import APIRouter, Depends, Query, status
from typing import Optional
import uuid

from app.core.dependencies import AuthedAsyncDBSession, PermissionChecker, get_current_user
from app.api.auth.models import User
from app.api.environment.environment_type.service import EnvironmentTypeService
from app.api.environment.environment_type.repository import EnvironmentTypeRepository
from app.api.environment.environment_type.models import (
    EnvironmentTypeRead, EnvironmentTypeCreate, EnvironmentTypeUpdate
)

router = APIRouter()

@router.post("/", 
             response_model=EnvironmentTypeRead, 
             status_code=status.HTTP_201_CREATED)
async def create_environment_type(
    payload: EnvironmentTypeCreate, 
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker("environment:create"))
):
    service = EnvironmentTypeService(EnvironmentTypeRepository(db))
    return await service.create(payload)

@router.post("/ensure", 
             response_model=EnvironmentTypeRead, 
             status_code=status.HTTP_200_OK)
async def ensure_environment_type(
    payload: EnvironmentTypeCreate, 
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker("environment:create"))
):
    service = EnvironmentTypeService(EnvironmentTypeRepository(db))
    return await service.ensure_exists(payload.name)

@router.get("/", 
            response_model=dict)
async def get_all_environment_types(
    db: AuthedAsyncDBSession,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=10000),
    is_active: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    sort: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user)
):
    service = EnvironmentTypeService(EnvironmentTypeRepository(db))
    return await service.get_all(page, per_page, is_active, search, sort)

@router.get("/{type_id}", 
            response_model=EnvironmentTypeRead)
async def get_environment_type_by_id(
    type_id: uuid.UUID, 
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker("environment:read"))
):
    service = EnvironmentTypeService(EnvironmentTypeRepository(db))
    return await service.get_by_id(type_id)

@router.put("/{type_id}", 
            response_model=EnvironmentTypeRead)
async def update_environment_type(
    type_id: uuid.UUID, 
    payload: EnvironmentTypeUpdate, 
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker("environment:update"))
):
    service = EnvironmentTypeService(EnvironmentTypeRepository(db))
    return await service.update(type_id, payload)

@router.delete("/{type_id}")
async def delete_environment_type(
    type_id: uuid.UUID, 
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker("environment:delete"))
):
    service = EnvironmentTypeService(EnvironmentTypeRepository(db))
    return await service.delete(type_id)
