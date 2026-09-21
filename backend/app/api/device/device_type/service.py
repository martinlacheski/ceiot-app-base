import uuid
from typing import Optional

from fastapi import HTTPException, status

from app.api.device.device_type.models import (
    DeviceTypeCatalog,
    DeviceTypeCreate,
    DeviceTypeUpdate,
)
from app.api.device.device_type.repository import DeviceTypeRepository


class DeviceTypeService:
    def __init__(self, repo: DeviceTypeRepository):
        self.repo = repo

    async def create(self, payload: DeviceTypeCreate) -> DeviceTypeCatalog:
        if await self.repo.get_by_name(payload.name, is_active=True):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Device type with this name already exists",
            )

        inactive = await self.repo.get_by_name(payload.name, is_active=False)
        if inactive:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "INACTIVE_DUPLICATE",
                    "message": "Device type exists but is inactive.",
                    "id": str(inactive.id),
                },
            )

        return await self.repo.create(DeviceTypeCatalog(**payload.model_dump()))

    async def get_all(
        self,
        page: int = 1,
        per_page: int = 10,
        is_active: Optional[bool] = True,
        search: Optional[str] = None,
        sort: Optional[str] = None,
    ) -> dict:
        return await self.repo.get_all(page, per_page, is_active, search, sort)

    async def get_by_id(self, type_id: uuid.UUID) -> DeviceTypeCatalog:
        device_type = await self.repo.get_by_id(type_id)
        if not device_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device type not found",
            )
        return device_type

    async def update(
        self,
        type_id: uuid.UUID,
        payload: DeviceTypeUpdate,
    ) -> DeviceTypeCatalog:
        if payload.name:
            existing = await self.repo.get_by_name(payload.name, is_active=None)
            if existing and existing.id != type_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Device type with this name already exists",
                )

        updated = await self.repo.update(type_id, payload)
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device type not found",
            )
        return updated

    async def delete(self, type_id: uuid.UUID) -> dict:
        success = await self.repo.delete(type_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device type not found",
            )
        return {"message": "Device type deleted successfully"}
