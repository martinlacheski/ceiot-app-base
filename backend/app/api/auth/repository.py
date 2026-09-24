
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select, or_, col
from app.api.auth.models import User, UserUpdate
from typing import Optional
from datetime import datetime, timedelta
import uuid
from sqlalchemy import asc, case, desc, func, or_ as sa_or, update

from app.core.search import ILIKE_ESCAPE, ilike_pattern
from app.core.sorting import SortSpec


# Repositorio de usuarios
class UserRepository:

    # Inicialización de la sesión de la base de datos
    def __init__(self, db: AsyncSession):
        self.db = db


    # Crea un nuevo usuario
    async def create(self, user: User) -> User:
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    # Obtiene un usuario por su ID
    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        query = select(User).where(User.id == user_id)
        result = await self.db.exec(query)
        return result.first()

    # Obtiene un usuario por su correo electrónico
    async def get_by_email(self, email: str) -> User | None:
        query = select(User).where(User.email == email)
        result = await self.db.exec(query)
        return result.first()

    # Obtiene un usuario por su nombre de usuario
    async def get_by_username(self, username: str) -> User | None:
        query = select(User).where(User.username == username)
        result = await self.db.exec(query)
        return result.first()

    # Obtiene un usuario por su número de identificación
    async def get_by_identification_number(self, identification_number: str) -> User | None:
        query = select(User).where(
            User.identification_number == identification_number)
        result = await self.db.exec(query)
        return result.first()

    async def get_all(
        self,
        page: int = 1,
        per_page: int = 10,
        is_active: Optional[bool] = None,
        is_admin: Optional[bool] = None,
        search: Optional[str] = None,
        sort: SortSpec = (),
    ) -> dict:
        query = select(User)

        # Filtering
        if is_active is not None:
            query = query.where(User.is_active == is_active)
        if is_admin is not None:
            query = query.where(User.is_admin == is_admin)
        search_pattern = ilike_pattern(search)
        if search_pattern is not None:
            query = query.where(
                or_(
                    col(User.username).ilike(search_pattern, escape=ILIKE_ESCAPE),
                    col(User.email).ilike(search_pattern, escape=ILIKE_ESCAPE),
                    col(User.first_name).ilike(search_pattern, escape=ILIKE_ESCAPE),
                    col(User.last_name).ilike(search_pattern, escape=ILIKE_ESCAPE),
                    col(User.identification_number).ilike(
                        search_pattern, escape=ILIKE_ESCAPE
                    ),
                    case(
                        (User.is_active == True, "Activo"),
                        else_="Inactivo",
                    ).ilike(search_pattern, escape=ILIKE_ESCAPE),
                    case(
                        (User.is_admin == True, "Admin"),
                        else_="Usuario",
                    ).ilike(search_pattern, escape=ILIKE_ESCAPE),
                )
            )

        sort_mapping = {
            "username": (User.username, True, False),
            "email": (User.email, True, False),
            "firstName": (User.first_name, True, True),
            "lastName": (User.last_name, True, True),
            "identificationNumber": (User.identification_number, True, True),
            "isActive": (User.is_active, False, False),
            "isAdmin": (User.is_admin, False, False),
            "createdAt": (User.created_at, False, False),
            "lastLoginAt": (User.last_login_at, False, True),
            "lastSeenAt": (User.last_seen_at, False, True),
        }
        if sort:
            tie_direction = sort[-1][1]
            for field, direction in sort:
                sort_column, case_insensitive, nullable = sort_mapping[field]
                order_expr = func.lower(sort_column) if case_insensitive else sort_column
                ordered = desc(order_expr) if direction == "desc" else asc(order_expr)
                query = query.order_by(ordered.nulls_last() if nullable else ordered)
        else:
            query = query.order_by(desc(User.created_at))
            tie_direction = "desc"

        query = query.order_by(
            desc(User.id) if tie_direction == "desc" else asc(User.id)
        )

        from app.services.pagination import paginate_query_async
        return await paginate_query_async(
            db=self.db,
            model=User,
            base_query=query,
            page=page,
            per_page=per_page
        )

    async def update(self, user_id: uuid.UUID, user_update: UserUpdate) -> Optional[User]:
        user = await self.get_by_id(user_id)
        if not user:
            return None

        user_data = user_update.model_dump(exclude_unset=True)
        # Nunca actualizar la contraseña a través de este método si viene vacía o nula
        if "password" in user_data and not user_data["password"]:
            del user_data["password"]

        for key, value in user_data.items():
            setattr(user, key, value)

        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    # Activity writes. Plain Core UPDATEs: `updated_at` has an `onupdate`, so it is set to
    # itself to keep "Actualizado" meaning "the profile changed", not "the user logged in".
    async def touch_login(self, user_id: uuid.UUID, now: datetime) -> None:
        table = User.__table__
        await self.db.exec(
            update(table)
            .where(table.c.id == user_id)
            .values(last_login_at=now, last_seen_at=now, updated_at=table.c.updated_at)
        )
        await self.db.commit()

    async def touch_seen(
        self,
        user_id: uuid.UUID,
        now: datetime,
        min_interval: timedelta = timedelta(minutes=15),
    ) -> bool:
        """Set `last_seen_at` unless it is already fresher than `min_interval`.

        One conditional UPDATE, so concurrent requests cannot double write. Returns whether
        this call wrote.
        """
        table = User.__table__
        result = await self.db.exec(
            update(table)
            .where(
                table.c.id == user_id,
                sa_or(table.c.last_seen_at.is_(None), table.c.last_seen_at <= now - min_interval),
            )
            .values(last_seen_at=now, updated_at=table.c.updated_at)
        )
        await self.db.commit()
        return result.rowcount > 0

    async def delete(self, user_id: uuid.UUID) -> bool:
        user = await self.get_by_id(user_id)
        if not user:
            return False

        # Se realiza la eliminación lógica
        user.is_active = False

        # Se actualiza la fecha de modificación
        self.db.add(user)
        await self.db.commit()
        return True
