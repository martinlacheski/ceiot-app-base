import uuid
from typing import Literal, Optional
from fastapi import APIRouter, Depends, Query, status

from app.core.dependencies import AuthedAsyncDBSession, PermissionChecker, get_current_user
from app.api.auth.models import User
from app.api.environment.environment.service import EnvironmentService
from app.api.environment.environment.repository import EnvironmentRepository
from app.api.environment.environment.models import (
    EnvironmentRead, EnvironmentCreate, EnvironmentUpdate
)

router = APIRouter()

@router.post("/", 
             response_model=EnvironmentRead, 
             status_code=status.HTTP_201_CREATED)
async def create_environment(
    payload: EnvironmentCreate, 
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker("environment:create"))
):
    service = EnvironmentService(EnvironmentRepository(db))
    # Pass current_user.id
    return await service.create(payload, user_id=current_user.id)

@router.get("/check", status_code=status.HTTP_200_OK)
async def check_availability(
    db: AuthedAsyncDBSession,
    name: Optional[str] = None,
    address: Optional[str] = None,
    city_id: Optional[uuid.UUID] = None,
    current_user: User = Depends(PermissionChecker("environment:create")) # Reuse create permission
):
    service = EnvironmentService(EnvironmentRepository(db))
    return await service.check_availability(current_user.id, name, address, city_id)

@router.get("/", 
            response_model=dict)
async def get_all_environments(
    db: AuthedAsyncDBSession,
    city_id: Optional[uuid.UUID] = None,
    state_id: Optional[uuid.UUID] = None,
    country_id: Optional[uuid.UUID] = None,
    type_id: Optional[uuid.UUID] = None,
    user_id: Optional[uuid.UUID] = None,
    owner_id: Optional[uuid.UUID] = Query(
        None, description="ID del dueño del establecimiento (solo admin con environment:read_all)"
    ),
    page: int = 1,
    per_page: int = 10,
    is_active: Optional[bool] = None,
    sort_by: Literal["name", "type", "owner", "status"] = Query("name"),
    sort_order: Literal["asc", "desc"] = Query("asc"),
    current_user: User = Depends(get_current_user)
):
    service = EnvironmentService(EnvironmentRepository(db))

    # Secure Listing Logic
    if not current_user.is_admin or "environment:read_all" not in (current_user.permissions or []):
        user_id = current_user.id
        owner_id = current_user.id if owner_id else None

    result = await service.get_all(
        city_id,
        state_id,
        country_id,
        type_id,
        user_id,
        page,
        per_page,
        is_active,
        current_user,
        sort_by,
        sort_order,
        owner_id,
    )
    # Serialize to ensure computed properties (owner_name) and camelCase are applied
    result["items"] = [
        item if isinstance(item, EnvironmentRead) else EnvironmentRead.model_validate(item)
        for item in result["items"]
    ]
    return result

@router.get("/{env_id}", 
            response_model=EnvironmentRead)
async def get_environment_by_id(
    env_id: uuid.UUID,
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker("environment:read"))
):
    service = EnvironmentService(EnvironmentRepository(db))
    return await service.get_by_id(env_id)

@router.put("/{env_id}", 
            response_model=EnvironmentRead)
async def update_environment(
    env_id: uuid.UUID,
    payload: EnvironmentUpdate,
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker("environment:update"))
):
    service = EnvironmentService(EnvironmentRepository(db))
    return await service.update(env_id, payload, current_user)

@router.delete("/{env_id}")
async def delete_environment(
    env_id: uuid.UUID,
    db: AuthedAsyncDBSession,
    current_user: User = Depends(PermissionChecker("environment:delete"))
):
    service = EnvironmentService(EnvironmentRepository(db))
    return await service.delete(env_id, current_user)
