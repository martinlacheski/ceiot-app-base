from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from typing import Optional, List
import uuid
from datetime import datetime
from sqlalchemy.orm import joinedload
from sqlalchemy import asc, case, desc, func

from app.api.location.models import (
    LocationCountry, LocationCountryUpdate,
    LocationState, LocationStateUpdate,
    LocationCity, LocationCityUpdate
)
from app.core.search import ILIKE_ESCAPE, ilike_pattern
from app.core.sorting import SortSpec

class LocationRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    # Country
    async def create_country(self, country: LocationCountry) -> LocationCountry:
        self.db.add(country)
        await self.db.commit()
        await self.db.refresh(country)
        return country

    async def get_country_by_id(self, country_id: uuid.UUID) -> Optional[LocationCountry]:
        query = select(LocationCountry).where(
            LocationCountry.id == country_id
        )
        result = await self.db.exec(query)
        return result.first()

    async def get_country_by_name(self, name: str, is_active: Optional[bool] = True) -> Optional[LocationCountry]:
        # Case insensitive search
        from sqlalchemy import func
        query = select(LocationCountry).where(
            func.lower(LocationCountry.name) == name.lower()
        )
        if is_active is not None:
             query = query.where(LocationCountry.is_active == is_active)
             
        result = await self.db.exec(query)
        return result.first()

    async def get_all_countries(
        self,
        page: int = 1,
        per_page: int = 10,
        is_active: bool = True,
        search: Optional[str] = None,
        sort: SortSpec = ()
    ) -> dict:
        query = select(LocationCountry)
        
        if is_active is not None:
             query = query.where(LocationCountry.is_active == is_active)
        
        search_pattern = ilike_pattern(search)
        if search_pattern is not None:
            from sqlalchemy import or_
            from sqlmodel import col
            query = query.where(
                or_(
                    col(LocationCountry.name).ilike(
                        search_pattern, escape=ILIKE_ESCAPE
                    ),
                    case(
                        (LocationCountry.is_active == True, "Activo"),
                        else_="Inactivo",
                    ).ilike(search_pattern, escape=ILIKE_ESCAPE),
                )
            )

        sort_mapping = {
            "name": (LocationCountry.name, True, False),
            "isActive": (LocationCountry.is_active, False, False),
        }
        query = self._apply_sort(query, sort, sort_mapping, LocationCountry.id)

        from app.services.pagination import paginate_query_async
        return await paginate_query_async(
            db=self.db,
            model=LocationCountry,
            base_query=query,
            page=page,
            per_page=per_page
        )

    async def update_country(self, country_id: uuid.UUID, country_update: LocationCountryUpdate) -> Optional[LocationCountry]:
        country = await self.get_country_by_id(country_id)
        if not country:
            return None
        
        country_data = country_update.model_dump(exclude_unset=True)
        for key, value in country_data.items():
            setattr(country, key, value)
            
        self.db.add(country)
        await self.db.commit()
        await self.db.refresh(country)
        return country

    async def delete_country(self, country_id: uuid.UUID) -> bool:
        country = await self.get_country_by_id(country_id)
        if not country:
            return False
        
        country.is_active = False
        self.db.add(country)
        await self.db.commit()
        return True

    # State
    async def create_state(self, state: LocationState) -> LocationState:
        self.db.add(state)
        await self.db.commit()
        await self.db.refresh(state)
        # Reload with relationship
        query = select(LocationState).where(LocationState.id == state.id).options(joinedload(LocationState.country))
        result = await self.db.exec(query)
        return result.first()

    async def get_state_by_id(self, state_id: uuid.UUID) -> Optional[LocationState]:
        query = select(LocationState).where(
            LocationState.id == state_id
        ).options(joinedload(LocationState.country))
        result = await self.db.exec(query)
        return result.first()

    async def get_state_by_name(self, name: str, country_id: uuid.UUID, is_active: Optional[bool] = True) -> Optional[LocationState]:
        # Case insensitive search within a country
        from sqlalchemy import func
        query = select(LocationState).where(
            func.lower(LocationState.name) == name.lower(),
            LocationState.country_id == country_id
        ).options(joinedload(LocationState.country))
        if is_active is not None:
            query = query.where(LocationState.is_active == is_active)
            
        result = await self.db.exec(query)
        return result.first()

    async def get_all_states(
        self,
        country_id: Optional[uuid.UUID] = None,
        page: int = 1,
        per_page: int = 10,
        is_active: bool = True,
        search: Optional[str] = None,
        sort: SortSpec = ()
    ) -> dict:
        from sqlalchemy.orm import contains_eager
        query = select(LocationState).join(LocationState.country).options(contains_eager(LocationState.country))
        if country_id:
            query = query.where(LocationState.country_id == country_id)

        if is_active is not None:
             query = query.where(LocationState.is_active == is_active)

        search_pattern = ilike_pattern(search)
        if search_pattern is not None:
            from sqlalchemy import or_
            from sqlmodel import col
            query = query.where(
                or_(
                    col(LocationState.name).ilike(
                        search_pattern, escape=ILIKE_ESCAPE
                    ),
                    col(LocationCountry.name).ilike(
                        search_pattern, escape=ILIKE_ESCAPE
                    ),
                    case(
                        (LocationState.is_active == True, "Activo"),
                        else_="Inactivo",
                    ).ilike(search_pattern, escape=ILIKE_ESCAPE),
                )
            )

        sort_mapping = {
            "name": (LocationState.name, True, False),
            "countryName": (LocationCountry.name, True, False),
            "isActive": (LocationState.is_active, False, False),
        }
        query = self._apply_sort(query, sort, sort_mapping, LocationState.id)

            
        from app.services.pagination import paginate_query_async
        return await paginate_query_async(
            db=self.db,
            model=LocationState,
            base_query=query,
            page=page,
            per_page=per_page
        )

    async def update_state(self, state_id: uuid.UUID, state_update: LocationStateUpdate) -> Optional[LocationState]:
        state = await self.get_state_by_id(state_id)
        if not state:
            return None
            
        state_data = state_update.model_dump(exclude_unset=True)
        for key, value in state_data.items():
            setattr(state, key, value)

        self.db.add(state)
        await self.db.commit()
        await self.db.refresh(state)
        return state

    async def delete_state(self, state_id: uuid.UUID) -> bool:
        state = await self.get_state_by_id(state_id)
        if not state:
            return False
            
        state.is_active = False
        self.db.add(state)
        await self.db.commit()
        return True

    # City
    async def create_city(self, city: LocationCity) -> LocationCity:
        self.db.add(city)
        await self.db.commit()
        await self.db.refresh(city)
        # Reload with relationships
        query = select(LocationCity).where(LocationCity.id == city.id).options(
            joinedload(LocationCity.state).joinedload(LocationState.country)
        )
        result = await self.db.exec(query)
        return result.first()

    async def get_city_by_id(self, city_id: uuid.UUID) -> Optional[LocationCity]:
        query = select(LocationCity).where(
            LocationCity.id == city_id
        ).options(joinedload(LocationCity.state).joinedload(LocationState.country))
        result = await self.db.exec(query)
        return result.first()

    async def get_city_by_name(self, name: str, state_id: uuid.UUID, is_active: Optional[bool] = True) -> Optional[LocationCity]:
        # Case insensitive search within a state
        from sqlalchemy import func
        query = select(LocationCity).where(
            func.lower(LocationCity.name) == name.lower(),
            LocationCity.state_id == state_id
        ).options(joinedload(LocationCity.state).joinedload(LocationState.country))
        if is_active is not None:
           query = query.where(LocationCity.is_active == is_active)
           
        result = await self.db.exec(query)
        return result.first()

    async def get_all_cities(
        self,
        country_id: Optional[uuid.UUID] = None,
        state_id: Optional[uuid.UUID] = None,
        page: int = 1,
        per_page: int = 10,
        is_active: bool = True,
        search: Optional[str] = None,
        sort: SortSpec = ()
    ) -> dict:
        from sqlalchemy.orm import contains_eager
        query = select(LocationCity).join(LocationCity.state).join(LocationState.country).options(
            contains_eager(LocationCity.state).contains_eager(LocationState.country)
        )
        
        if country_id:
            query = query.where(LocationState.country_id == country_id)

        if state_id:
            query = query.where(LocationCity.state_id == state_id)

        if is_active is not None:
             query = query.where(LocationCity.is_active == is_active)

        search_pattern = ilike_pattern(search)
        if search_pattern is not None:
            from sqlalchemy import or_
            from sqlmodel import col
            query = query.where(
                or_(
                    col(LocationCity.name).ilike(
                        search_pattern, escape=ILIKE_ESCAPE
                    ),
                    col(LocationCity.postal_code).ilike(
                        search_pattern, escape=ILIKE_ESCAPE
                    ),
                    col(LocationState.name).ilike(
                        search_pattern, escape=ILIKE_ESCAPE
                    ),
                    col(LocationCountry.name).ilike(
                        search_pattern, escape=ILIKE_ESCAPE
                    ),
                    case(
                        (LocationCity.is_active == True, "Activo"),
                        else_="Inactivo",
                    ).ilike(search_pattern, escape=ILIKE_ESCAPE),
                )
            )

        sort_mapping = {
            "name": (LocationCity.name, True, False),
            "postalCode": (LocationCity.postal_code, True, True),
            "isActive": (LocationCity.is_active, False, False),
            "stateName": (LocationState.name, True, False),
            "countryName": (LocationCountry.name, True, False),
        }
        query = self._apply_sort(query, sort, sort_mapping, LocationCity.id)
            
        from app.services.pagination import paginate_query_async
        return await paginate_query_async(
            db=self.db,
            model=LocationCity,
            base_query=query,
            page=page,
            per_page=per_page
        )

    @staticmethod
    def _apply_sort(query, sort: SortSpec, mapping, id_column):
        effective_sort = sort or (("name", "asc"),)
        tie_direction = effective_sort[-1][1]
        for field, direction in effective_sort:
            column, case_insensitive, nullable = mapping[field]
            expression = func.lower(column) if case_insensitive else column
            ordered = desc(expression) if direction == "desc" else asc(expression)
            query = query.order_by(ordered.nulls_last() if nullable else ordered)
        return query.order_by(
            desc(id_column) if tie_direction == "desc" else asc(id_column)
        )

    async def update_city(self, city_id: uuid.UUID, city_update: LocationCityUpdate) -> Optional[LocationCity]:
        city = await self.get_city_by_id(city_id)
        if not city:
            return None

        city_data = city_update.model_dump(exclude_unset=True)
        for key, value in city_data.items():
            setattr(city, key, value)

        self.db.add(city)
        await self.db.commit()
        await self.db.refresh(city)
        return city

    async def delete_city(self, city_id: uuid.UUID) -> bool:
        city = await self.get_city_by_id(city_id)
        if not city:
            return False
            
        city.is_active = False
        self.db.add(city)
        await self.db.commit()
        return True
