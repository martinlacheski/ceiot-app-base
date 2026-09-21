from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from typing import Optional
from sqlalchemy import func
import uuid

from app.api.environment.environment_type.models import EnvironmentType, EnvironmentTypeUpdate
from app.services.pagination import paginate_query_async

class EnvironmentTypeRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, environment_type: EnvironmentType) -> EnvironmentType:
        self.db.add(environment_type)
        await self.db.commit()
        await self.db.refresh(environment_type)
        return environment_type

    async def get_by_id(self, type_id: uuid.UUID) -> Optional[EnvironmentType]:
        query = select(EnvironmentType).where(
            EnvironmentType.id == type_id
        )
        result = await self.db.exec(query)
        return result.first()

    async def get_by_name(self, name: str, is_active: Optional[bool] = True) -> Optional[EnvironmentType]:
        query = select(EnvironmentType).where(
            func.lower(EnvironmentType.name) == name.lower()
        )
        if is_active is not None:
            query = query.where(EnvironmentType.is_active == is_active)
        
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
        query = select(EnvironmentType)
        if is_active is not None:
            query = query.where(EnvironmentType.is_active == is_active)

        if search:
            from sqlalchemy import col
            search_pattern = f"%{search}%"
            query = query.where(col(EnvironmentType.name).ilike(search_pattern))

        if sort:
            from sqlalchemy import asc, desc, func
            sort_mapping = {
                "name": EnvironmentType.name,
                "is_active": EnvironmentType.is_active
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
             query = query.order_by(asc(EnvironmentType.name))
            
        return await paginate_query_async(
            db=self.db,
            model=EnvironmentType,
            base_query=query,
            page=page,
            per_page=per_page
        )

    async def update(self, type_id: uuid.UUID, type_update: EnvironmentTypeUpdate) -> Optional[EnvironmentType]:
        env_type = await self.get_by_id(type_id)
        if not env_type:
            return None
            
        type_data = type_update.model_dump(exclude_unset=True)
        for key, value in type_data.items():
            setattr(env_type, key, value)
            
        self.db.add(env_type)
        await self.db.commit()
        await self.db.refresh(env_type)
        return env_type

    async def delete(self, type_id: uuid.UUID) -> bool:
        env_type = await self.get_by_id(type_id)
        if not env_type:
            return False
            
        env_type.is_active = False
        self.db.add(env_type)
        await self.db.commit()
        return True
