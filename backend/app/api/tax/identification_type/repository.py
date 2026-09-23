from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from typing import Optional, List
import uuid
from sqlalchemy import case, func

from app.api.tax.identification_type.models import (
    IdentificationType, IdentificationTypeUpdate
)
from app.core.search import ILIKE_ESCAPE, ilike_pattern

class IdentificationTypeRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, item: IdentificationType) -> IdentificationType:
        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def get_by_id(self, item_id: uuid.UUID) -> Optional[IdentificationType]:
        query = select(IdentificationType).where(
            IdentificationType.id == item_id
        )
        result = await self.db.exec(query)
        return result.first()

    async def get_by_name(self, name: str, is_active: Optional[bool] = True) -> Optional[IdentificationType]:
        query = select(IdentificationType).where(
            func.lower(IdentificationType.name) == name.lower()
        )
        if is_active is not None:
             query = query.where(IdentificationType.is_active == is_active)
        result = await self.db.exec(query)
        return result.first()

    async def get_all(
        self,
        page: int = 1,
        per_page: int = 10,
        is_active: bool = True,
        search: Optional[str] = None,
        sort: Optional[str] = None
    ) -> dict:
        query = select(IdentificationType)
        if is_active is not None:
             query = query.where(IdentificationType.is_active == is_active)
        
        search_pattern = ilike_pattern(search)
        if search_pattern is not None:
            from sqlalchemy import or_
            from sqlmodel import col
            query = query.where(
                or_(
                    col(IdentificationType.name).ilike(
                        search_pattern, escape=ILIKE_ESCAPE
                    ),
                    case(
                        (IdentificationType.is_active == True, "Activo"),
                        else_="Inactivo",
                    ).ilike(search_pattern, escape=ILIKE_ESCAPE),
                )
            )

        if sort:
            from sqlalchemy import asc, desc, func
            sort_mapping = {
                "name": IdentificationType.name,
                "is_active": IdentificationType.is_active
            }
            
            sort_params = sort.split(",")
            for param in sort_params:
                if ":" in param:
                    field, direction = param.split(":")
                else:
                    field, direction = param, "asc"
                
                sort_column = sort_mapping.get(field.strip())
                if sort_column is not None:
                    if field.strip() in ["name"]:
                         order_expr = func.lower(sort_column)
                    else:
                        order_expr = sort_column
                    
                    if direction.lower() == "desc":
                        query = query.order_by(desc(order_expr))
                    else:
                        query = query.order_by(asc(order_expr))
        else:
             from sqlalchemy import asc
             query = query.order_by(asc(IdentificationType.name))

        from app.services.pagination import paginate_query_async
        return await paginate_query_async(
            db=self.db,
            model=IdentificationType,
            base_query=query,
            page=page,
            per_page=per_page
        )

    async def update(self, item_id: uuid.UUID, item_update: IdentificationTypeUpdate) -> Optional[IdentificationType]:
        item = await self.get_by_id(item_id)
        if not item:
            return None
        
        item_data = item_update.model_dump(exclude_unset=True)
        for key, value in item_data.items():
            setattr(item, key, value)
            
        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)
        return item

    async def delete(self, item_id: uuid.UUID) -> bool:
        item = await self.get_by_id(item_id)
        if not item:
            return False
        
        item.is_active = False
        self.db.add(item)
        await self.db.commit()
        return True
