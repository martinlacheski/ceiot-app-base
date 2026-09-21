import uuid
from typing import Literal

from fastapi import HTTPException, status

from app.api.environment.environment.models import (
    Environment, EnvironmentCreate, EnvironmentRead, EnvironmentUpdate,
)
from app.api.auth.models import User
from app.api.environment.environment.repository import EnvironmentRepository
from app.core.db import system_session

class EnvironmentService:
    def __init__(self, repo: EnvironmentRepository):
        self.repo = repo

    async def create(self, payload: EnvironmentCreate, user_id: uuid.UUID) -> Environment:
        # Check Uniqueness (Name + Owner)
        if await self.repo.get_by_owner_and_name(payload.name, user_id, is_active=True):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ya posees un establecimiento con este nombre"
            )

        # Check Uniqueness (Address + City)
        if await self.repo.get_by_address(payload.address, payload.city_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Ya existe un establecimiento con esta dirección en esta ciudad"
            )

        inactive = await self.repo.get_by_owner_and_name(payload.name, user_id, is_active=False)
        if inactive:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "INACTIVE_DUPLICATE", "message": "Ya posees un establecimiento con este nombre pero está inactivo.", "id": str(inactive.id)}
            )

        # Create Environment + assign owner atomically
        environment_data = payload.model_dump()
        env = Environment(**environment_data)
        return await self.repo.create(env, owner_id=user_id)

    async def get_all(
        self,
        city_id: uuid.UUID | None = None,
        state_id: uuid.UUID | None = None,
        country_id: uuid.UUID | None = None,
        type_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
        page: int = 1,
        per_page: int = 10,
        is_active: bool = True,
        actor_user: User | None = None,
        sort_by: Literal["name", "type", "owner", "status"] = "name",
        sort_order: Literal["asc", "desc"] = "asc",
        owner_id: uuid.UUID | None = None,
    ) -> dict:
        result = await self.repo.get_all(
            city_id, state_id, country_id, type_id, user_id, page, per_page,
            is_active, sort_by, sort_order, owner_id,
        )
        if actor_user is not None:
            actor_user_id = actor_user.id
            if actor_user_id is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Usuario autenticado inválido",
                )
            environment_ids = [environment.id for environment in result["items"]]
            owner_metadata = await self.repo.get_owner_metadata(environment_ids)
            missing_owner_ids = [
                environment_id
                for environment_id in environment_ids
                if environment_id not in owner_metadata
            ]
            if missing_owner_ids:
                async with system_session() as sys_session:
                    owner_metadata.update(
                        await EnvironmentRepository(sys_session).get_owner_metadata(
                            missing_owner_ids,
                        )
                    )

            enriched_items = []
            for environment in result["items"]:
                role = await self.repo.get_contextual_role(environment.id, actor_user_id)
                can_manage = role == "owner" or "environment:read_all" in actor_user.permissions
                metadata = owner_metadata.get(environment.id, {})
                enriched_items.append(
                    EnvironmentRead.model_validate(environment).model_copy(
                        update={
                            "owner_id": metadata.get("owner_id", environment.owner_id),
                            "owner_name": metadata.get("owner_name", environment.owner_name),
                            "current_user_role": role,
                            "can_edit": can_manage,
                            "can_delete": can_manage,
                        }
                    )
                )
            result["items"] = enriched_items
        return result

    async def get_by_id(self, env_id: uuid.UUID) -> Environment:
        env = await self.repo.get_by_id(env_id)
        if not env:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Establecimiento no encontrado"
            )
        return env

    async def update(self, env_id: uuid.UUID, payload: EnvironmentUpdate, actor_user: User | None = None) -> Environment:
        if actor_user is not None:
            await self._require_owner_or_admin(env_id, actor_user)
        current_env = await self.repo.get_by_id(env_id)
        if not current_env:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Establecimiento no encontrado")

        target_city_id = payload.city_id or current_env.city_id

        if payload.name:
            # Check if owner has another environment with this name
            owner_id = current_env.owner_id
            if owner_id:
                existing = await self.repo.get_by_owner_and_name(payload.name, owner_id)
                if existing and existing.id != env_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Ya posees un establecimiento con este nombre"
                    )
            else:
                 # Fallback if no owner (shouldn't happen for valid envs but safe to have legacy check or skip)
                 # If no owner, maybe we shouldn't block name? Or stick to city check?
                 # Project standard says environments have owners.
                 pass

        if payload.address:
            existing_addr = await self.repo.get_by_address(payload.address, target_city_id)
            if existing_addr and existing_addr.id != env_id:
                raise HTTPException(
                     status_code=status.HTTP_400_BAD_REQUEST,
                     detail="Ya existe un establecimiento con esta dirección en esta ciudad"
                )

        env = await self.repo.update(env_id, payload)
        if not env:
             raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Establecimiento no encontrado")
        return env

    async def delete(self, env_id: uuid.UUID, actor_user: User | None = None) -> dict:
        if actor_user is not None:
            await self._require_owner_or_admin(env_id, actor_user)
        success = await self.repo.delete(env_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Establecimiento no encontrado"
            )
        return {"message": "Establecimiento eliminado correctamente"}

    async def check_availability(
        self,
        user_id: uuid.UUID,
        name: str | None = None,
        address: str | None = None,
        city_id: uuid.UUID | None = None,
    ) -> dict:
        if name:
            existing = await self.repo.get_by_owner_and_name(name, user_id, is_active=True)
            if existing:
                return {"available": False, "code": "NAME_EXISTS", "message": "Ya posees un establecimiento con este nombre"}

            # Check inactive too? User might want to reactivate instead.
            # Mirroring create logic:
            existing_inactive = await self.repo.get_by_owner_and_name(name, user_id, is_active=False)
            if existing_inactive:
                return {"available": False, "code": "NAME_EXISTS_INACTIVE", "message": "Ya posees un establecimiento inactivo con este nombre"}

        if address and city_id:
            existing = await self.repo.get_by_address(address, city_id)
            if existing:
                 return {"available": False, "code": "ADDRESS_EXISTS", "message": "Ya existe un establecimiento con esta dirección en esta ciudad"}

        return {"available": True, "message": "Disponible"}

    async def _require_owner_or_admin(self, env_id: uuid.UUID, actor_user: User) -> None:
        if "environment:read_all" in actor_user.permissions:
            return
        actor_user_id = actor_user.id
        if actor_user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Usuario autenticado inválido",
            )
        role = await self.repo.get_user_role(env_id, actor_user_id)
        if not role or not role.is_owner:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo el propietario puede modificar este establecimiento",
            )
