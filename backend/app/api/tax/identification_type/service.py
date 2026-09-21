from fastapi import HTTPException, status
from typing import Optional
import uuid

from app.api.tax.identification_type.models import (
    IdentificationType, IdentificationTypeCreate, IdentificationTypeUpdate
)
from app.api.tax.identification_type.repository import IdentificationTypeRepository

class IdentificationTypeService:
    def __init__(self, repo: IdentificationTypeRepository):
        self.repo = repo

    async def create(self, payload: IdentificationTypeCreate) -> IdentificationType:
        # 1. Check active duplicate
        if await self.repo.get_by_name(payload.name, is_active=True):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El tipo de identificación con este nombre ya existe"
            )
        
        # 2. Check inactive duplicate (Reactivation)
        inactive = await self.repo.get_by_name(payload.name, is_active=False)
        if inactive:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "INACTIVE_DUPLICATE", "message": "El tipo de identificación existe pero está inactivo.", "id": str(inactive.id)}
            )

        item = IdentificationType(**payload.model_dump())
        return await self.repo.create(item)

    async def get_all(
        self,
        page: int = 1,
        per_page: int = 10,
        is_active: Optional[bool] = True,
        search: Optional[str] = None,
        sort: Optional[str] = None
    ) -> dict:
        return await self.repo.get_all(page, per_page, is_active, search, sort)

    async def get_by_id(self, item_id: uuid.UUID) -> IdentificationType:
        item = await self.repo.get_by_id(item_id)
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tipo de identificación no encontrado"
            )
        return item

    async def update(self, item_id: uuid.UUID, payload: IdentificationTypeUpdate) -> IdentificationType:
        if payload.name:
            existing = await self.repo.get_by_name(payload.name)
            if existing and existing.id != item_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El tipo de identificación con este nombre ya existe"
                )

        item = await self.repo.update(item_id, payload)
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tipo de identificación no encontrado"
            )
        return item

    async def delete(self, item_id: uuid.UUID) -> dict:
        success = await self.repo.delete(item_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tipo de identificación no encontrado"
            )
        return {"message": "Tipo de identificación eliminado correctamente"}
