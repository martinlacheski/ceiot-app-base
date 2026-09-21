from fastapi import HTTPException, status
from typing import Any, Dict, List, Optional, Tuple
import uuid
import os
import re
import httpx
import logging

logger = logging.getLogger(__name__)

GEOCODER_RESULT_TYPE_PRIORITY = (
    "street_address",
    "subpremise",
    "premise",
    "route",
    "intersection",
    "establishment",
    "point_of_interest",
)

GENERIC_GEOCODER_RESULT_TYPES = {
    "postal_code",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "administrative_area_level_3",
    "country",
    "locality",
    "political",
    "plus_code",
}
from app.api.location.models import (
    LocationCountry, LocationCountryCreate, LocationCountryUpdate,
    LocationState, LocationStateCreate, LocationStateUpdate,
    LocationCity, LocationCityCreate, LocationCityUpdate
)
from app.api.location.repository import LocationRepository
from app.core.sorting import SortSpec

class LocationService:
    def __init__(self, repo: LocationRepository):
        self.repo = repo

    # Country
    async def create_country(self, payload: LocationCountryCreate) -> LocationCountry:
        # 1. Check if exists active
        if await self.repo.get_country_by_name(payload.name, is_active=True):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El país con este nombre ya existe"
            )
        
        # 2. Check if exists inactive
        inactive_duplicate = await self.repo.get_country_by_name(payload.name, is_active=False)
        if inactive_duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "INACTIVE_DUPLICATE", "message": "El país existe pero está inactivo.", "id": str(inactive_duplicate.id)}
            )
        country = LocationCountry(**payload.model_dump())
        return await self.repo.create_country(country)

    async def get_all_countries(
        self,
        page: int = 1,
        per_page: int = 10,
        is_active: Optional[bool] = True,
        search: Optional[str] = None,
        sort: SortSpec = ()
    ) -> dict:
        return await self.repo.get_all_countries(page, per_page, is_active, search, sort)

    async def get_country_by_id(self, country_id: uuid.UUID) -> LocationCountry:
        country = await self.repo.get_country_by_id(country_id)
        if not country:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="País no encontrado"
            )
        return country

    async def update_country(self, country_id: uuid.UUID, payload: LocationCountryUpdate) -> LocationCountry:
        if payload.name:
            existing = await self.repo.get_country_by_name(payload.name)
            if existing and existing.id != country_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El país con este nombre ya existe"
                )

        country = await self.repo.update_country(country_id, payload)
        if not country:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="País no encontrado"
            )
        return country

    async def delete_country(self, country_id: uuid.UUID) -> dict:
        success = await self.repo.delete_country(country_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="País no encontrado"
            )
        return {"message": "País eliminado correctamente"}

    # State
    async def create_state(self, payload: LocationStateCreate) -> LocationState:
        # Verify country exists
        country = await self.repo.get_country_by_id(payload.country_id)
        if not country:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="País no encontrado"
            )
        
        # Check uniqueness within country
        # 1. Check uniqueness within country (Active)
        if await self.repo.get_state_by_name(payload.name, payload.country_id, is_active=True):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La provincia con este nombre ya existe en este país"
            )

        # 2. Check uniqueness within country (Inactive)
        inactive_duplicate = await self.repo.get_state_by_name(payload.name, payload.country_id, is_active=False)
        if inactive_duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "INACTIVE_DUPLICATE", "message": "La provincia existe pero está inactiva.", "id": str(inactive_duplicate.id)}
            )

        state = LocationState(**payload.model_dump())
        return await self.repo.create_state(state)

    async def get_all_states(
        self,
        country_id: Optional[uuid.UUID] = None,
        page: int = 1,
        per_page: int = 10,
        is_active: Optional[bool] = True,
        search: Optional[str] = None,
        sort: SortSpec = ()
    ) -> dict:
        return await self.repo.get_all_states(country_id, page, per_page, is_active, search, sort)

    async def get_state_by_id(self, state_id: uuid.UUID) -> LocationState:
        state = await self.repo.get_state_by_id(state_id)
        if not state:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Provincia no encontrada"
            )
        return state

    async def update_state(self, state_id: uuid.UUID, payload: LocationStateUpdate) -> LocationState:
        current_state = await self.repo.get_state_by_id(state_id)
        if not current_state:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Provincia no encontrada")

        target_country_id = payload.country_id or current_state.country_id

        if payload.country_id:
             country = await self.repo.get_country_by_id(payload.country_id)
             if not country:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="País no encontrado"
                )

        if payload.name:
            existing = await self.repo.get_state_by_name(payload.name, target_country_id)
            if existing and existing.id != state_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La provincia con este nombre ya existe en este país"
                )

        state = await self.repo.update_state(state_id, payload)
        if not state:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Provincia no encontrada"
            )
        return state

    async def delete_state(self, state_id: uuid.UUID) -> dict:
        success = await self.repo.delete_state(state_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Provincia no encontrada"
            )
        return {"message": "Provincia eliminada correctamente"}

    # City
    async def create_city(self, payload: LocationCityCreate) -> LocationCity:
        # Verify state exists
        state = await self.repo.get_state_by_id(payload.state_id)
        if not state:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Provincia no encontrada"
            )

        # Check uniqueness within state
        # 1. Check uniqueness within state (Active)
        if await self.repo.get_city_by_name(payload.name, payload.state_id, is_active=True):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La ciudad con este nombre ya existe en esta provincia"
            )
        
        # 2. Check uniqueness within state (Inactive)
        inactive_duplicate = await self.repo.get_city_by_name(payload.name, payload.state_id, is_active=False)
        if inactive_duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "INACTIVE_DUPLICATE", "message": "La ciudad existe pero está inactiva.", "id": str(inactive_duplicate.id)}
            )

        city = LocationCity(**payload.model_dump())
        return await self.repo.create_city(city)

    async def get_all_cities(
        self,
        country_id: Optional[uuid.UUID] = None,
        state_id: Optional[uuid.UUID] = None,
        page: int = 1,
        per_page: int = 10,
        is_active: Optional[bool] = True,
        search: Optional[str] = None,
        sort: SortSpec = ()
    ) -> dict:
        return await self.repo.get_all_cities(country_id, state_id, page, per_page, is_active, search, sort)

    async def get_city_by_id(self, city_id: uuid.UUID) -> LocationCity:
        city = await self.repo.get_city_by_id(city_id)
        if not city:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ciudad no encontrada"
            )
        return city

    async def update_city(self, city_id: uuid.UUID, payload: LocationCityUpdate) -> LocationCity:
        current_city = await self.repo.get_city_by_id(city_id)
        if not current_city:
             raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ciudad no encontrada")

        target_state_id = payload.state_id or current_city.state_id

        if payload.state_id:
            state = await self.repo.get_state_by_id(payload.state_id)
            if not state:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Provincia no encontrada"
                )

        if payload.name:
            existing = await self.repo.get_city_by_name(payload.name, target_state_id)
            if existing and existing.id != city_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="La ciudad con este nombre ya existe en esta provincia"
                )

        city = await self.repo.update_city(city_id, payload)
        if not city:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ciudad no encontrada"
            )
        return city

    async def delete_city(self, city_id: uuid.UUID) -> dict:
        success = await self.repo.delete_city(city_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ciudad no encontrada"
            )
        return {"message": "Ciudad eliminada correctamente"}

    # Geolocation Support
    async def resolve_location(self, input_value: str) -> Dict[str, Any]:
        """
        Resolves a location from a Google Maps link or lat,long string.
        Returns mapped city_id, state_id, country_id, address, description, lat, lng.
        """
        api_key = os.getenv("GCP_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="GCP_API_KEY no configurada en el servidor")

        lat, lng = await self._parse_input_to_coords(input_value)
        
        # Call Google Geocoding API
        try:
            async with httpx.AsyncClient() as client:
                params = {"key": api_key, "language": "es"}
                if lat and lng:
                    params["latlng"] = f"{lat},{lng}"
                else:
                    # Treat as address/text search
                    params["address"] = input_value

                response = await client.get(
                    "https://maps.googleapis.com/maps/api/geocode/json",
                    params=params
                )
                data = response.json()
        except Exception as e:
            logger.error(f"Error calling Google API: {e}")
            raise HTTPException(status_code=500, detail=f"Error al contactar con Google Maps API: {str(e)}")

        if data.get("status") != "OK" or not data.get("results"):
             raise HTTPException(status_code=400, detail="Google Maps no pudo resolver la dirección para estas coordenadas.")

        result = self._select_best_geocoder_result(data["results"])
        formatted_address = result.get("formatted_address", "")
        
        # Parse components
        components = result.get("address_components", [])
        country_name = None
        state_name = None
        city_name = None
        postal_code = "0000" # Default if not found

        for comp in components:
            types = comp.get("types", [])
            if "country" in types:
                country_name = comp["long_name"]
            elif "administrative_area_level_1" in types:
                state_name = comp["long_name"]
            elif "locality" in types or "administrative_area_level_2" in types:
                # Prefer locality, fallback to level 2 (often county/city in some places)
                if not city_name or "locality" in types:
                    city_name = comp["long_name"]
            elif "postal_code" in types:
                postal_code = comp["long_name"]

        if not country_name or not state_name or not city_name:
             # Try to start filling in gaps? match existing?
             # For now, require basic hierarchy to be resolvable
             pass

        if not country_name:
             country_name = "Desconocido"
        if not state_name:
             state_name = "Desconocido"
        if not city_name:
             city_name = "Desconocido"

        # Ensure Entities Exist
        country = await self._ensure_country(country_name)
        state = await self._ensure_state(state_name, country.id)
        city = await self._ensure_city(city_name, state.id, postal_code)

        return {
            "latitude": lat,
            "longitude": lng,
            "address": formatted_address,
            "description": formatted_address, # Use formatted address as initial description or place name?
            "city_id": city.id,
            "state_id": state.id,
            "country_id": country.id,
            "country_name": country.name,
            "state_name": state.name,
            "city_name": city.name,
        }

    def _select_best_geocoder_result(self, results: list[Dict[str, Any]]) -> Dict[str, Any]:
        def has_component(result: Dict[str, Any], component_type: str) -> bool:
            return any(
                component_type in component.get("types", [])
                for component in result.get("address_components", [])
            )

        def get_priority_index(types: list[str]) -> int:
            for index, result_type in enumerate(GEOCODER_RESULT_TYPE_PRIORITY):
                if result_type in types:
                    return index
            return len(GEOCODER_RESULT_TYPE_PRIORITY)

        def score(result_with_index: Tuple[int, Dict[str, Any]]) -> Tuple[int, int, int, int, int]:
            index, result = result_with_index
            types = result.get("types", [])
            has_street_number = has_component(result, "street_number")
            has_route = has_component(result, "route")
            priority_index = get_priority_index(types)
            is_generic_only = int(bool(types) and all(result_type in GENERIC_GEOCODER_RESULT_TYPES for result_type in types))

            return (
                0 if has_route and has_street_number else 1,
                priority_index,
                0 if has_route else 1,
                is_generic_only,
                index,
            )

        return min(enumerate(results), key=score)[1]

    async def _parse_input_to_coords(self, input_value: str) -> Tuple[Optional[float], Optional[float]]:
        # 1. Try pure lat,long
        # Regex for "lat, long" or "lat,long"
        match = re.search(r"([-+]?\d{1,2}\.\d+),\s*([-+]?\d{1,3}\.\d+)", input_value)
        if match:
            return float(match.group(1)), float(match.group(2))
        
        # 2. Try Google Maps URL
        # Detect standard or short URLs
        if "http" in input_value:
             # If short URL, resolve it first
             final_url = input_value
             if "goo.gl" in input_value or "maps.app.goo.gl" in input_value:
                 try:
                    async with httpx.AsyncClient() as client:
                        resp = await client.head(input_value, follow_redirects=True)
                        final_url = str(resp.url)
                 except:
                     logger.warning("Could not expand URL")
            
             # Try to extract @lat,lng
             # URL often looks like .../place/.../@-26.5695366,-54.7535891,17z/...
             match_url = re.search(r"@([-+]?\d{1,2}\.\d+),([-+]?\d{1,3}\.\d+)", final_url)
             if match_url:
                 return float(match_url.group(1)), float(match_url.group(2))
             
             # Sometimes it is ?q=lat,lng
             match_q = re.search(r"[?&]q=([-+]?\d{1,2}\.\d+),([-+]?\d{1,3}\.\d+)", final_url)
             if match_q:
                 return float(match_q.group(1)), float(match_q.group(2))
                 
        return None, None

    async def _ensure_country(self, name: str) -> LocationCountry:
        # Check active
        country = await self.repo.get_country_by_name(name, is_active=True)
        if country: return country
        
        # Check inactive? If inactive, we might reactivate or just return it? 
        # For now, lets try to find any.
        # Since repo methods filter by is_active=True by default often, check if we can generic find.
        # The repo method Signature: get_country_by_name(self, name: str, is_active: Optional[bool] = None)
        # So passing None checks all.
        country = await self.repo.get_country_by_name(name, is_active=None)
        if country:
            return country # Return even if inactive? Or error? Let's return.

        # Create
        new_country = LocationCountryCreate(name=name)
        return await self.repo.create_country(LocationCountry(**new_country.model_dump()))

    async def _ensure_state(self, name: str, country_id: uuid.UUID) -> LocationState:
        state = await self.repo.get_state_by_name(name, country_id, is_active=None)
        if state: return state
        
        new_state = LocationStateCreate(name=name, country_id=country_id)
        return await self.repo.create_state(LocationState(**new_state.model_dump()))

    async def _ensure_city(self, name: str, state_id: uuid.UUID, postal_code: str) -> LocationCity:
        city = await self.repo.get_city_by_name(name, state_id, is_active=None)
        if city: return city

        new_city = LocationCityCreate(name=name, state_id=state_id, postal_code=postal_code)
        return await self.repo.create_city(LocationCity(**new_city.model_dump()))
