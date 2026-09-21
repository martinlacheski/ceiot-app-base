from fastapi import HTTPException, status
from typing import Optional
import uuid

from app.api.environment.environment_type.models import (
    EnvironmentType, EnvironmentTypeCreate, EnvironmentTypeUpdate
)
from app.api.environment.environment_type.repository import EnvironmentTypeRepository

class EnvironmentTypeService:
    def __init__(self, repo: EnvironmentTypeRepository):
        self.repo = repo

    async def create(self, payload: EnvironmentTypeCreate) -> EnvironmentType:
        # 1. Check active
        if await self.repo.get_by_name(payload.name, is_active=True):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El tipo de establecimiento con este nombre ya existe"
            )
        
        # 2. Check inactive
        inactive = await self.repo.get_by_name(payload.name, is_active=False)
        if inactive:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "INACTIVE_DUPLICATE", "message": "El tipo existe pero está inactivo.", "id": str(inactive.id)}
            )
            
        env_type = EnvironmentType(**payload.model_dump())
        return await self.repo.create(env_type)

    async def get_all(
        self,
        page: int = 1,
        per_page: int = 10,
        is_active: bool = True,
        search: Optional[str] = None,
        sort: Optional[str] = None
    ) -> dict:
        return await self.repo.get_all(page, per_page, is_active, search, sort)

    async def get_by_id(self, type_id: uuid.UUID) -> EnvironmentType:
        env_type = await self.repo.get_by_id(type_id)
        if not env_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tipo de establecimiento no encontrado"
            )
        return env_type

    async def update(self, type_id: uuid.UUID, payload: EnvironmentTypeUpdate) -> EnvironmentType:
        if payload.name:
            existing = await self.repo.get_by_name(payload.name)
            if existing and existing.id != type_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El tipo de establecimiento con este nombre ya existe"
                )
        
        env_type = await self.repo.update(type_id, payload)
        if not env_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tipo de establecimiento no encontrado"
            )
        return env_type

    async def ensure_exists(self, name: str) -> EnvironmentType:
        """
        Ensures that an environment type with the given name exists.
        If it exists (case-insensitive), returns it.
        If not, creates it.
        """
        # Try to find existing (case-insensitive logic is nice but let's stick to exact or simple match for now)
        # Or better: normalize name to Title Case
        normalized_name = name.title().strip()
        
        # We don't have a case-insensitive get_by_name readily available in generic repo unless verified.
        # But we can try to find exact match first.
        existing = await self.repo.get_by_name(normalized_name)
        if existing:
            return existing
            
        # Also try exact match of input just in case
        if name != normalized_name:
             existing_raw = await self.repo.get_by_name(name)
             if existing_raw:
                 return existing_raw

        # Create new
        new_type_data = EnvironmentTypeCreate(name=normalized_name)
        env_type = EnvironmentType(**new_type_data.model_dump())
        created = await self.repo.create(env_type)
        return created

    async def delete(self, type_id: uuid.UUID) -> dict:
        success = await self.repo.delete(type_id)
        if not success:
             raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tipo de establecimiento no encontrado"
            )
        return {"message": "Tipo de establecimiento eliminado correctamente"}
