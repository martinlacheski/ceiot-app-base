from fastapi import APIRouter, Depends, Query, status
from typing import Optional
import uuid

from app.core.dependencies import AsyncDBSession, PermissionChecker
from app.api.tax.identification_type.models import (
    IdentificationTypeCreate, IdentificationTypeRead, IdentificationTypeUpdate
)
from app.api.tax.identification_type.repository import IdentificationTypeRepository
from app.api.tax.identification_type.service import IdentificationTypeService

router = APIRouter()

async def get_service(db: AsyncDBSession) -> IdentificationTypeService:
    return IdentificationTypeService(IdentificationTypeRepository(db))

@router.post("/", response_model=IdentificationTypeRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(PermissionChecker("tax:create"))])
async def create_identification_type(
    payload: IdentificationTypeCreate,
    service: IdentificationTypeService = Depends(get_service)
):
    return await service.create(payload)

@router.get("/", response_model=dict, dependencies=[Depends(PermissionChecker("tax:read"))])
async def get_all_identification_types(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=10000),
    is_active: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    sort: Optional[str] = Query(None),
    service: IdentificationTypeService = Depends(get_service)
):
    return await service.get_all(page, per_page, is_active, search, sort)

@router.get("/{item_id}", response_model=IdentificationTypeRead, dependencies=[Depends(PermissionChecker("tax:read"))])
async def get_identification_type(
    item_id: uuid.UUID,
    service: IdentificationTypeService = Depends(get_service)
):
    return await service.get_by_id(item_id)

@router.put("/{item_id}", response_model=IdentificationTypeRead, dependencies=[Depends(PermissionChecker("tax:update"))])
async def update_identification_type(
    item_id: uuid.UUID,
    payload: IdentificationTypeUpdate,
    service: IdentificationTypeService = Depends(get_service)
):
    return await service.update(item_id, payload)

@router.delete("/{item_id}", dependencies=[Depends(PermissionChecker("tax:delete"))])
async def delete_identification_type(
    item_id: uuid.UUID,
    service: IdentificationTypeService = Depends(get_service)
):
    return await service.delete(item_id)
