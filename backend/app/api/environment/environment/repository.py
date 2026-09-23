from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select
from typing import Literal, Optional
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import aliased
import uuid

from app.api.environment.environment.models import (
    Environment, EnvironmentUpdate,
    EnvironmentUser
)
from app.api.environment.invitation.models import EnvironmentInvitation
from app.services.pagination import paginate_query_async
from sqlalchemy.orm import selectinload
from app.api.location.models import LocationCity, LocationState, LocationCountry
from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.device.models import Device
from app.api.auth.models import User
from app.api.environment.environment_type.models import EnvironmentType

class EnvironmentRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, environment: Environment, owner_id: uuid.UUID | None = None) -> Environment:
        self.db.add(environment)
        await self.db.flush()  # Get the ID without committing

        # Add owner to environmentuser BEFORE commit so RLS allows the SELECT refresh
        if owner_id:
            env_user = EnvironmentUser(
                environment_id=environment.id,
                user_id=owner_id,
                is_owner=True,
                is_active=True,
            )
            self.db.add(env_user)

        await self.db.commit()

        # Re-fetch with relationships loaded to avoid MissingGreenlet during serialization
        query = select(Environment).where(Environment.id == environment.id).options(
            selectinload(Environment.type),
            selectinload(Environment.city).selectinload(LocationCity.state).selectinload(LocationState.country),
            selectinload(Environment.users).selectinload(EnvironmentUser.user)
        )
        result = await self.db.exec(query)
        return result.one()

    async def get_by_id(self, env_id: uuid.UUID) -> Optional[Environment]:
        query = select(Environment).where(
            Environment.id == env_id
        ).options(
            selectinload(Environment.type),
            selectinload(Environment.city).selectinload(LocationCity.state).selectinload(LocationState.country),
            selectinload(Environment.users).selectinload(EnvironmentUser.user)
        )
        result = await self.db.exec(query)
        return result.first()
        
    async def get_by_name(self, name: str, city_id: uuid.UUID, is_active: Optional[bool] = True) -> Optional[Environment]:
        # Assuming name unique per city
        query = select(Environment).where(
            func.lower(Environment.name) == name.lower(),
            Environment.city_id == city_id
        )
        if is_active is not None:
             query = query.where(Environment.is_active == is_active)
        
        result = await self.db.exec(query)
        return result.first()

    async def get_by_owner_and_name(self, name: str, owner_id: uuid.UUID, is_active: Optional[bool] = True) -> Optional[Environment]:
        query = select(Environment).join(EnvironmentUser).where(
            func.lower(Environment.name) == name.lower(),
            EnvironmentUser.user_id == owner_id,
            EnvironmentUser.is_owner == True,
            EnvironmentUser.is_active == True
        )
        if is_active is not None:
             query = query.where(Environment.is_active == is_active)
        
        result = await self.db.exec(query)
        return result.first()

    async def get_by_address(self, address: str, city_id: uuid.UUID) -> Optional[Environment]:
        query = select(Environment).where(
            func.lower(Environment.address) == address.lower(),
            Environment.city_id == city_id,
            Environment.is_active == True
        )
        result = await self.db.exec(query)
        return result.first()


    async def get_all(
        self,
        city_id: Optional[uuid.UUID] = None,
        state_id: Optional[uuid.UUID] = None,
        country_id: Optional[uuid.UUID] = None,
        type_id: Optional[uuid.UUID] = None,
        user_id: Optional[uuid.UUID] = None,
        page: int = 1,
        per_page: int = 10,
        is_active: Optional[bool] = None,
        sort_by: Literal["name", "type", "owner", "status"] = "name",
        sort_order: Literal["asc", "desc"] = "asc",
        owner_id: Optional[uuid.UUID] = None,
        search: Optional[str] = None,
        actor_user_id: Optional[uuid.UUID] = None,
        owner_search_environment_ids: Optional[list[uuid.UUID]] = None,
    ) -> dict:
        query = select(Environment).options(
            selectinload(Environment.type),
            selectinload(Environment.city).selectinload(LocationCity.state).selectinload(LocationState.country),
            selectinload(Environment.users).selectinload(EnvironmentUser.user)
        )
        
        # Joins for filtering if needed
        if country_id or state_id:
            query = query.join(Environment.city)
            
        if country_id:
             query = query.join(LocationCity.state).join(LocationState.country).where(LocationCountry.id == country_id)
        
        if state_id:
             # If we already joined state for country, we don't need to join again if logic handles it, 
             # but standard SQLAlchemy might need explicit join if not careful. 
             # However, if country_id is NOT present, we need to join state.
             # If country_id IS present, we already joined state.
             # Let's handle generic joins more carefully or just rely on the query builder smarts?
             # Safer to check if we haven't joined yet, or just chain joins.
             # Actually, if we use alias or basic joins, re-joining the same table might error or alias.
             # Let's assume standard path: Environment -> City -> State.
             if not country_id:
                  query = query.join(LocationCity.state)
             query = query.where(LocationState.id == state_id)

        if city_id:
            query = query.where(Environment.city_id == city_id)
        if type_id:
            query = query.where(Environment.type_id == type_id)
            
        if user_id:
            environment_member_exists = select(EnvironmentUser.id).where(
                EnvironmentUser.environment_id == Environment.id,
                EnvironmentUser.user_id == user_id,
                EnvironmentUser.is_active == True,
            ).exists()
            environment_guest_exists = select(ScopedGuestRelation.id).where(
                ScopedGuestRelation.scope_type == ScopeType.ENVIRONMENT,
                ScopedGuestRelation.scope_id == Environment.id,
                ScopedGuestRelation.guest_user_id == user_id,
                ScopedGuestRelation.is_active == True,
            ).exists()
            device_guest_exists = select(ScopedGuestRelation.id).join(
                Device,
                Device.id == ScopedGuestRelation.scope_id,
            ).where(
                ScopedGuestRelation.scope_type == ScopeType.DEVICE,
                Device.environment_id == Environment.id,
                ScopedGuestRelation.guest_user_id == user_id,
                ScopedGuestRelation.is_active == True,
            ).exists()
            query = query.where(
                or_(environment_member_exists, environment_guest_exists, device_guest_exists)
            )

        if owner_id:
            # Filtro estricto por dueño (distinto de user_id, que incluye miembro/invitado/dueño).
            # Mismo patrón que DeviceRepository.get_all y ReportRepository._apply_owner_filter.
            OwnerEnvUser = aliased(EnvironmentUser)
            query = query.join(
                OwnerEnvUser, OwnerEnvUser.environment_id == Environment.id
            ).where(
                OwnerEnvUser.user_id == owner_id,
                OwnerEnvUser.is_owner == True,
                OwnerEnvUser.is_active == True,
            )

        if is_active is not None:
             query = query.where(Environment.is_active == is_active)

        if search:
            search_pattern = f"%{search}%"

            SearchEnvironmentType = aliased(EnvironmentType)
            type_matches = select(SearchEnvironmentType.id).where(
                SearchEnvironmentType.id == Environment.type_id,
                SearchEnvironmentType.name.ilike(search_pattern),
            ).exists()

            SearchOwnerRelation = aliased(EnvironmentUser)
            SearchOwner = aliased(User)
            owner_full_name = func.trim(
                SearchOwner.first_name + " " + SearchOwner.last_name
            )
            owner_matches = select(SearchOwnerRelation.id).join(
                SearchOwner,
                SearchOwner.id == SearchOwnerRelation.user_id,
            ).where(
                SearchOwnerRelation.environment_id == Environment.id,
                SearchOwnerRelation.is_owner == True,
                SearchOwnerRelation.is_active == True,
                or_(
                    SearchOwner.first_name.ilike(search_pattern),
                    SearchOwner.last_name.ilike(search_pattern),
                    owner_full_name.ilike(search_pattern),
                    and_(
                        func.nullif(owner_full_name, "").is_(None),
                        SearchOwner.username.ilike(search_pattern),
                    ),
                ),
            ).exists()

            SearchCity = aliased(LocationCity)
            SearchState = aliased(LocationState)
            SearchCountry = aliased(LocationCountry)
            administrative_location_matches = select(SearchCity.id).join(
                SearchState,
                SearchState.id == SearchCity.state_id,
            ).join(
                SearchCountry,
                SearchCountry.id == SearchState.country_id,
            ).where(
                SearchCity.id == Environment.city_id,
                or_(
                    SearchCity.name.ilike(search_pattern),
                    SearchState.name.ilike(search_pattern),
                    SearchCountry.name.ilike(search_pattern),
                ),
            ).exists()

            search_conditions = [
                Environment.name.ilike(search_pattern),
                type_matches,
                owner_matches,
                Environment.address.ilike(search_pattern),
                Environment.location.ilike(search_pattern),
                administrative_location_matches,
                case(
                    (Environment.is_active == True, "Activo"),
                    else_="Inactivo",
                ).ilike(search_pattern),
            ]

            if owner_search_environment_ids:
                search_conditions.append(
                    Environment.id.in_(owner_search_environment_ids)
                )

            if actor_user_id is not None:
                ActorEnvironmentUser = aliased(EnvironmentUser)
                ActorEnvironmentGuest = aliased(ScopedGuestRelation)
                ActorDeviceGuest = aliased(ScopedGuestRelation)
                ActorGuestDevice = aliased(Device)
                actor_owner_role = select(ActorEnvironmentUser.id).where(
                    ActorEnvironmentUser.environment_id == Environment.id,
                    ActorEnvironmentUser.user_id == actor_user_id,
                    ActorEnvironmentUser.is_owner == True,
                    ActorEnvironmentUser.is_active == True,
                ).exists()
                actor_environment_guest = select(ActorEnvironmentGuest.id).where(
                    ActorEnvironmentGuest.scope_type == ScopeType.ENVIRONMENT,
                    ActorEnvironmentGuest.scope_id == Environment.id,
                    ActorEnvironmentGuest.guest_user_id == actor_user_id,
                    ActorEnvironmentGuest.is_active == True,
                ).exists()
                actor_device_guest = select(ActorDeviceGuest.id).join(
                    ActorGuestDevice,
                    ActorGuestDevice.id == ActorDeviceGuest.scope_id,
                ).where(
                    ActorDeviceGuest.scope_type == ScopeType.DEVICE,
                    ActorGuestDevice.environment_id == Environment.id,
                    ActorDeviceGuest.guest_user_id == actor_user_id,
                    ActorDeviceGuest.is_active == True,
                ).exists()
                search_conditions.append(
                    case(
                        (actor_owner_role, "Propietario"),
                        (
                            or_(actor_environment_guest, actor_device_guest),
                            "Invitado",
                        ),
                        else_="",
                    ).ilike(search_pattern)
                )

            query = query.where(or_(*search_conditions))

        sort_expression = Environment.name
        if sort_by == "type":
            query = query.join(EnvironmentType, EnvironmentType.id == Environment.type_id)
            sort_expression = EnvironmentType.name
        elif sort_by == "owner":
            query = query.outerjoin(
                EnvironmentUser,
                (EnvironmentUser.environment_id == Environment.id)
                & (EnvironmentUser.is_owner == True)
                & (EnvironmentUser.is_active == True),
            ).outerjoin(User, User.id == EnvironmentUser.user_id)
            sort_expression = func.coalesce(
                func.nullif(func.trim(User.first_name + " " + User.last_name), ""),
                User.username,
            )
        elif sort_by == "status":
            sort_expression = Environment.is_active

        direction = sort_expression.desc if sort_order == "desc" else sort_expression.asc
        query = query.order_by(direction(), Environment.id.asc())

        return await paginate_query_async(
            db=self.db,
            model=Environment,
            base_query=query,
            page=page,
            per_page=per_page
        )

    async def get_owner_search_environment_ids(
        self,
        search: str,
    ) -> list[uuid.UUID]:
        """Resolve owner display-name matches outside the paginated list query.

        Non-admin RLS sessions cannot see another user's EnvironmentUser owner row,
        even when the environment itself is visible through guest access. The service
        can run this lookup with a system-scoped session and pass the IDs back into
        the RLS-scoped list query, where they are still intersected with environments
        the actor is allowed to read.
        """
        search_pattern = f"%{search}%"
        owner_full_name = func.trim(User.first_name + " " + User.last_name)
        query = select(EnvironmentUser.environment_id).join(
            User,
            User.id == EnvironmentUser.user_id,
        ).where(
            EnvironmentUser.is_owner == True,
            EnvironmentUser.is_active == True,
            or_(
                User.first_name.ilike(search_pattern),
                User.last_name.ilike(search_pattern),
                owner_full_name.ilike(search_pattern),
                and_(
                    func.nullif(owner_full_name, "").is_(None),
                    User.username.ilike(search_pattern),
                ),
            ),
        )
        rows = await self.db.exec(query)
        return list(rows.all())

    async def update(self, env_id: uuid.UUID, env_update: EnvironmentUpdate) -> Optional[Environment]:
        env = await self.get_by_id(env_id)
        if not env:
            return None
            
        env_data = env_update.model_dump(exclude_unset=True)
        for key, value in env_data.items():
            setattr(env, key, value)
            
        self.db.add(env)
        await self.db.commit()
        await self.db.refresh(env)
        return env

    async def delete(self, env_id: uuid.UUID) -> bool:
        env = await self.get_by_id(env_id)
        if not env:
            return False
            
        env.is_active = False
        self.db.add(env)
        await self.db.commit()
        return True

    # EnvironmentUser
    async def create_user(self, env_user: EnvironmentUser) -> EnvironmentUser:
        self.db.add(env_user)
        await self.db.commit()
        await self.db.refresh(env_user)
        return env_user

    async def get_user_role(self, env_id: uuid.UUID, user_id: uuid.UUID) -> Optional[EnvironmentUser]:
        query = select(EnvironmentUser).where(
            EnvironmentUser.environment_id == env_id,
            EnvironmentUser.user_id == user_id,
            EnvironmentUser.is_active == True
        )
        result = await self.db.exec(query)
        return result.first()

    async def is_scoped_guest(self, env_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        environment_guest_query = select(ScopedGuestRelation.id).where(
            ScopedGuestRelation.scope_type == ScopeType.ENVIRONMENT,
            ScopedGuestRelation.scope_id == env_id,
            ScopedGuestRelation.guest_user_id == user_id,
            ScopedGuestRelation.is_active == True,
        )
        environment_guest = (await self.db.exec(environment_guest_query)).first()
        if environment_guest is not None:
            return True

        device_guest_query = select(ScopedGuestRelation.id).join(
            Device,
            Device.id == ScopedGuestRelation.scope_id,
        ).where(
            ScopedGuestRelation.scope_type == ScopeType.DEVICE,
            Device.environment_id == env_id,
            ScopedGuestRelation.guest_user_id == user_id,
            ScopedGuestRelation.is_active == True,
        )
        device_guest = (await self.db.exec(device_guest_query)).first()
        return device_guest is not None

    async def get_contextual_role(self, env_id: uuid.UUID, user_id: uuid.UUID) -> Optional[str]:
        env_user = await self.get_user_role(env_id, user_id)
        if env_user and env_user.is_owner:
            return "owner"
        if await self.is_scoped_guest(env_id, user_id):
            return "guest"
        return None

    async def get_owner_metadata(
        self,
        environment_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, dict[str, object]]:
        if not environment_ids:
            return {}

        query = select(EnvironmentUser, User).join(
            User,
            User.id == EnvironmentUser.user_id,
        ).where(
            EnvironmentUser.environment_id.in_(environment_ids),
            EnvironmentUser.is_owner == True,
            EnvironmentUser.is_active == True,
        )
        rows = await self.db.exec(query)
        metadata: dict[uuid.UUID, dict[str, object]] = {}
        for env_user, user in rows.all():
            owner_name = f"{user.first_name} {user.last_name}".strip() or user.username
            metadata[env_user.environment_id] = {
                "owner_id": env_user.user_id,
                "owner_name": owner_name,
            }
        return metadata

    async def remove_user(self, env_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        env_user = await self.get_user_role(env_id, user_id)
        if not env_user:
            return False
            
        # We can hard delete or soft delete. 
        # Since EnvironmentUser connects entities, hard delete might be cleaner 
        # if we want to allow re-invite without "conflict" on inactive link.
        # But project standard says Logical Deletion generally.
        # If we soft delete, the unique constraint (if any) might block re-creation unless partial index.
        # Let's check models.py for UniqueConstraint? 
        # Assuming Logical Deletion for now:
        env_user.is_active = False
        self.db.add(env_user)
        await self.db.commit()
        return True
