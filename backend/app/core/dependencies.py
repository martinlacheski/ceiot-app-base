
from typing import Annotated, AsyncGenerator
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session
from sqlalchemy import text

from sqlmodel.ext.asyncio.session import AsyncSession
from app.core.db import get_session, get_async_session, async_engine
from app.core.security import decode_token
from app.api.auth.models import User
from app.api.auth.repository import UserRepository

oauth2 = OAuth2PasswordBearer(tokenUrl="login")


# Método para obtener la sesión de la base de datos
def get_db() -> Session:
    return next(get_session())


# Se envuelve la dependencia de la sesión en un Annotated para que sea tipado
# db: Session = Depends(get_db)
DBSession = Annotated[Session, Depends(get_db)]
AsyncDBSession = Annotated[AsyncSession, Depends(get_async_session)]
# db: DBSession


# Método para obtener el usuario actual
async def get_current_user(token: Annotated[str, Depends(oauth2)], db: AsyncDBSession) -> User:

    # Excepción para cuando el token no es válido
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No autorizado",
        headers={"WWW-Authenticate": "Bearer"}
    )

    # Se intenta decodificar el token
    try:
        payload = decode_token(token)
        data = payload.get("data")

        # Si no hay datos o el id no está en los datos, se lanza la excepción
        if not data or "id" not in data:
            raise credentials_exc

        # Se obtiene el id del usuario
        import uuid
        user_id = uuid.UUID(data["id"])
    except Exception:
        raise credentials_exc

    # Se intenta obtener el usuario
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)

    # Si el usuario no existe, se lanza la excepción
    if not user:
        raise credentials_exc

    # Se retorna el usuario
    return user


# Se envuelve la dependencia del usuario en un Annotated para que sea tipado
CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_authed_session(
    current_user: User = Depends(get_current_user),
) -> AsyncGenerator[AsyncSession, None]:
    """Sesión autenticada: setea app.current_user_id para RLS.
    Usa conexión explícita para que el SET SESSION persista a través de commits intermedios.
    set_config se ejecuta a través de la sesión para evitar join_transaction_mode="conditional_savepoint".
    """
    uid = "system_admin" if current_user.is_admin else str(current_user.id)
    async with async_engine.connect() as conn:
        async with AsyncSession(conn, expire_on_commit=False) as session:
            await session.execute(
                text("SELECT set_config('app.current_user_id', :uid, false)"),
                {"uid": uid}
            )
            yield session


AuthedAsyncDBSession = Annotated[AsyncSession, Depends(get_authed_session)]


async def get_system_session() -> AsyncGenerator[AsyncSession, None]:
    """Sesión de sistema para webhooks externos (sin usuario). Bypasea RLS con system_mqtt.
    Usa conexión explícita para que el SET SESSION persista a través de commits intermedios.
    set_config se ejecuta a través de la sesión para evitar join_transaction_mode="conditional_savepoint".
    """
    async with async_engine.connect() as conn:
        async with AsyncSession(conn, expire_on_commit=False) as session:
            await session.execute(
                text("SELECT set_config('app.current_user_id', 'system_mqtt', false)")
            )
            yield session


SystemAsyncDBSession = Annotated[AsyncSession, Depends(get_system_session)]


class PermissionChecker:
    def __init__(self, required_permission: str):
        self.required_permission = required_permission

    def __call__(self, user: CurrentUser):
        if self.required_permission not in (user.permissions or []):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos suficientes para realizar esta acción"
            )
        return user
