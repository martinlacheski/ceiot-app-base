import uuid
from typing import Optional

from sqlalchemy import func
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.device_type.constants import (
    DEFAULT_DEVICE_TYPE_CODE,
    DEFAULT_DEVICE_TYPE_ID,
    DEFAULT_DEVICE_TYPE_NAME,
    LEGACY_OTHER_DEVICE_TYPE_CODE,
    LEGACY_OTHER_DEVICE_TYPE_ID,
    LEGACY_OTHER_DEVICE_TYPE_NAME,
)
from app.api.device.device_type.models import (
    DeviceTypeCatalog,
    DeviceTypeUpdate,
)
from app.services.pagination import paginate_query_async


class DeviceTypeRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, device_type: DeviceTypeCatalog) -> DeviceTypeCatalog:
        self.db.add(device_type)
        await self.db.commit()
        await self.db.refresh(device_type)
        return device_type

    async def get_by_id(self, type_id: uuid.UUID) -> Optional[DeviceTypeCatalog]:
        query = select(DeviceTypeCatalog).where(DeviceTypeCatalog.id == type_id)
        result = await self.db.exec(query)
        return result.first()

    async def get_by_name(
        self,
        name: str,
        is_active: Optional[bool] = True,
    ) -> Optional[DeviceTypeCatalog]:
        query = select(DeviceTypeCatalog).where(
            func.lower(DeviceTypeCatalog.name) == name.lower()
        )
        if is_active is not None:
            query = query.where(DeviceTypeCatalog.is_active == is_active)

        result = await self.db.exec(query)
        return result.first()

    async def get_default(self) -> Optional[DeviceTypeCatalog]:
        return await self.get_by_id(DEFAULT_DEVICE_TYPE_ID)

    async def get_legacy_other(self) -> Optional[DeviceTypeCatalog]:
        return await self.get_by_id(LEGACY_OTHER_DEVICE_TYPE_ID)

    async def ensure_default_exists(self) -> DeviceTypeCatalog:
        existing = await self.get_default()
        if existing:
            changed = False
            if not existing.is_active:
                existing.is_active = True
                changed = True
            if existing.id == DEFAULT_DEVICE_TYPE_ID and existing.code != DEFAULT_DEVICE_TYPE_CODE:
                existing.code = DEFAULT_DEVICE_TYPE_CODE
                changed = True
            if changed:
                self.db.add(existing)
                await self.db.commit()
                await self.db.refresh(existing)
            return existing

        default_type = DeviceTypeCatalog(
            id=DEFAULT_DEVICE_TYPE_ID,
            name=DEFAULT_DEVICE_TYPE_NAME,
            code=DEFAULT_DEVICE_TYPE_CODE,
            is_active=True,
        )
        self.db.add(default_type)
        await self.db.commit()
        await self.db.refresh(default_type)
        return default_type

    async def ensure_legacy_other_exists(self) -> DeviceTypeCatalog:
        existing = await self.get_legacy_other()
        if existing:
            changed = False
            if not existing.is_active:
                existing.is_active = True
                changed = True
            if existing.id == LEGACY_OTHER_DEVICE_TYPE_ID and existing.code != LEGACY_OTHER_DEVICE_TYPE_CODE:
                existing.code = LEGACY_OTHER_DEVICE_TYPE_CODE
                changed = True
            if changed:
                self.db.add(existing)
                await self.db.commit()
                await self.db.refresh(existing)
            return existing

        other_type = DeviceTypeCatalog(
            id=LEGACY_OTHER_DEVICE_TYPE_ID,
            name=LEGACY_OTHER_DEVICE_TYPE_NAME,
            code=LEGACY_OTHER_DEVICE_TYPE_CODE,
            is_active=True,
        )
        self.db.add(other_type)
        await self.db.commit()
        await self.db.refresh(other_type)
        return other_type

    async def resolve_catalog_type(
        self,
        *,
        device_type_id: Optional[uuid.UUID] = None,
        require_active: bool = False,
    ) -> Optional[DeviceTypeCatalog]:
        if device_type_id is not None:
            if device_type_id == DEFAULT_DEVICE_TYPE_ID:
                resolved = await self.ensure_default_exists()
                if resolved.is_active or not require_active:
                    return resolved
                return None

            if device_type_id == LEGACY_OTHER_DEVICE_TYPE_ID:
                resolved = await self.ensure_legacy_other_exists()
                if resolved.is_active or not require_active:
                    return resolved
                return None

            resolved = await self.get_by_id(device_type_id)
            if resolved and (resolved.is_active or not require_active):
                return resolved
            return None

        return await self.ensure_default_exists()

    async def get_all(
        self,
        page: int = 1,
        per_page: int = 10,
        is_active: Optional[bool] = True,
        search: Optional[str] = None,
        sort: Optional[str] = None,
    ) -> dict:
        await self.ensure_default_exists()

        query = select(DeviceTypeCatalog)
        if is_active is not None:
            query = query.where(DeviceTypeCatalog.is_active == is_active)

        if search:
            query = query.where(col(DeviceTypeCatalog.name).ilike(f"%{search}%"))

        if sort:
            from sqlalchemy import asc, desc

            sort_mapping = {
                "name": DeviceTypeCatalog.name,
                "is_active": DeviceTypeCatalog.is_active,
            }
            for param in sort.split(","):
                if ":" in param:
                    field, direction = param.split(":", 1)
                else:
                    field, direction = param, "asc"

                sort_column = sort_mapping.get(field.strip())
                if sort_column is None:
                    continue

                order_expr = func.lower(sort_column) if field.strip() == "name" else sort_column
                query = query.order_by(desc(order_expr) if direction.lower() == "desc" else asc(order_expr))
        else:
            from sqlalchemy import asc

            query = query.order_by(asc(DeviceTypeCatalog.name))

        return await paginate_query_async(
            db=self.db,
            model=DeviceTypeCatalog,
            base_query=query,
            page=page,
            per_page=per_page,
        )

    async def update(
        self,
        type_id: uuid.UUID,
        type_update: DeviceTypeUpdate,
    ) -> Optional[DeviceTypeCatalog]:
        device_type = await self.get_by_id(type_id)
        if not device_type:
            return None

        for key, value in type_update.model_dump(exclude_unset=True).items():
            setattr(device_type, key, value)

        self.db.add(device_type)
        await self.db.commit()
        await self.db.refresh(device_type)
        return device_type

    async def delete(self, type_id: uuid.UUID) -> bool:
        device_type = await self.get_by_id(type_id)
        if not device_type:
            return False

        device_type.is_active = False
        self.db.add(device_type)
        await self.db.commit()
        return True
