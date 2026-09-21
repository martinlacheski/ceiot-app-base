from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional, Dict, Any
import uuid

from app.core.dependencies import AsyncDBSession, PermissionChecker
from app.api.location.service import LocationService
from app.api.location.repository import LocationRepository
from app.api.location.models import (
    LocationCountryRead, LocationCountryCreate, LocationCountryUpdate,
    LocationStateRead, LocationStateCreate, LocationStateUpdate,
    LocationCityRead, LocationCityCreate, LocationCityUpdate
)
from app.core.sorting import parse_sort


COUNTRY_SORT_FIELDS = {
    "name": "name",
    "isActive": "isActive",
    "is_active": "isActive",
}
STATE_SORT_FIELDS = {
    "name": "name",
    "countryName": "countryName",
    "isActive": "isActive",
    "country_name": "countryName",
    "is_active": "isActive",
}
CITY_SORT_FIELDS = {
    "name": "name",
    "stateName": "stateName",
    "countryName": "countryName",
    "postalCode": "postalCode",
    "isActive": "isActive",
    "state_name": "stateName",
    "country_name": "countryName",
    "postal_code": "postalCode",
    "is_active": "isActive",
    "provincia": "stateName",
    "pais": "countryName",
    "estado": "isActive",
}

router = APIRouter(prefix="/location", tags=["Location"])

# Country
@router.post("/countries", 
             response_model=LocationCountryRead, 
             status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(PermissionChecker("location:create"))])
async def create_country(payload: LocationCountryCreate, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.create_country(payload)

@router.get("/countries", 
            response_model=dict,
            dependencies=[Depends(PermissionChecker("location:read"))])
async def get_all_countries(
    db: AsyncDBSession,
    page: int = 1,
    per_page: int = 10,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
    sort: Optional[str] = None
):
    parsed_sort = parse_sort(sort, COUNTRY_SORT_FIELDS, max_fields=2)
    service = LocationService(LocationRepository(db))
    return await service.get_all_countries(page, per_page, is_active, search, parsed_sort)

@router.get("/countries/{country_id}", 
            response_model=LocationCountryRead,
            dependencies=[Depends(PermissionChecker("location:read"))])
async def get_country_by_id(country_id: uuid.UUID, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.get_country_by_id(country_id)

@router.put("/countries/{country_id}", 
            response_model=LocationCountryRead,
            dependencies=[Depends(PermissionChecker("location:update"))])
async def update_country(country_id: uuid.UUID, payload: LocationCountryUpdate, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.update_country(country_id, payload)

@router.delete("/countries/{country_id}",
               dependencies=[Depends(PermissionChecker("location:delete"))])
async def delete_country(country_id: uuid.UUID, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.delete_country(country_id)

# State
@router.post("/states", 
             response_model=LocationStateRead, 
             status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(PermissionChecker("location:create"))])
async def create_state(payload: LocationStateCreate, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.create_state(payload)

@router.get("/states", 
            response_model=dict,
            dependencies=[Depends(PermissionChecker("location:read"))])
async def get_all_states(
    db: AsyncDBSession, 
    country_id: Optional[uuid.UUID] = None,
    page: int = 1,
    per_page: int = 10,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
    sort: Optional[str] = None
):
    parsed_sort = parse_sort(sort, STATE_SORT_FIELDS, max_fields=3)
    service = LocationService(LocationRepository(db))
    result = await service.get_all_states(country_id, page, per_page, is_active, search, parsed_sort)
    result["items"] = [LocationStateRead.model_validate(item) for item in result["items"]]
    return result

@router.get("/states/{state_id}", 
            response_model=LocationStateRead,
            dependencies=[Depends(PermissionChecker("location:read"))])
async def get_state_by_id(state_id: uuid.UUID, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.get_state_by_id(state_id)

@router.put("/states/{state_id}", 
            response_model=LocationStateRead,
            dependencies=[Depends(PermissionChecker("location:update"))])
async def update_state(state_id: uuid.UUID, payload: LocationStateUpdate, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.update_state(state_id, payload)

@router.delete("/states/{state_id}",
               dependencies=[Depends(PermissionChecker("location:delete"))])
async def delete_state(state_id: uuid.UUID, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.delete_state(state_id)

# City
@router.post("/cities", 
             response_model=LocationCityRead, 
             status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(PermissionChecker("location:create"))])
async def create_city(payload: LocationCityCreate, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.create_city(payload)

@router.get("/cities", 
            response_model=dict,
            dependencies=[Depends(PermissionChecker("location:read"))])
async def get_all_cities(
    db: AsyncDBSession,
    country_id: Optional[uuid.UUID] = None, 
    state_id: Optional[uuid.UUID] = None,
    page: int = 1,
    per_page: int = 10,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
    sort: Optional[str] = None
):
    parsed_sort = parse_sort(sort, CITY_SORT_FIELDS, max_fields=5)
    service = LocationService(LocationRepository(db))
    result = await service.get_all_cities(country_id, state_id, page, per_page, is_active, search, parsed_sort)
    result["items"] = [LocationCityRead.model_validate(item) for item in result["items"]]
    return result

@router.get("/cities/{city_id}", 
            response_model=LocationCityRead,
            dependencies=[Depends(PermissionChecker("location:read"))])
async def get_city_by_id(city_id: uuid.UUID, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.get_city_by_id(city_id)

@router.put("/cities/{city_id}", 
            response_model=LocationCityRead,
            dependencies=[Depends(PermissionChecker("location:update"))])
async def update_city(city_id: uuid.UUID, payload: LocationCityUpdate, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.update_city(city_id, payload)

@router.delete("/cities/{city_id}",
               dependencies=[Depends(PermissionChecker("location:delete"))])
async def delete_city(city_id: uuid.UUID, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.delete_city(city_id)

# Geolocation
from pydantic import BaseModel

class ResolveLocationRequest(BaseModel):
    input_value: str

@router.post("/resolve", 
             response_model=dict,
             dependencies=[Depends(PermissionChecker("location:read"))]) # Read permission seems appropriate? Or create if we create entities? Using 'read' mostly for resolution.
async def resolve_location(payload: ResolveLocationRequest, db: AsyncDBSession):
    service = LocationService(LocationRepository(db))
    return await service.resolve_location(payload.input_value)
