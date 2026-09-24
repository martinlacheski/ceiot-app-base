import logging
from datetime import datetime
from fastapi import HTTPException, status
from typing import Optional, Dict, Any
import uuid

from app.api.auth.models import User, UserCreate, UserUpdate
from app.api.auth.repository import UserRepository
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    validate_password_policy,
    verify_password,
)
from app.core.email import EmailService
from app.core.sorting import SortSpec


from app.core.config import settings
from app.core.permissions import ALL_PERMISSIONS, BASIC_PERMISSIONS

logger = logging.getLogger(__name__)

# Clase de servicio de autenticación
class AuthService:

    # Inicialización de la clase
    def __init__(self, repo: UserRepository):
        self.repo = repo

    # Registro de un nuevo usuario
    async def create(self, payload: UserCreate, is_verified: bool = False) -> User:

        validate_password_policy(payload.password)

        # Verificar si el email ya está registrado
        existing_email = await self.repo.get_by_email(payload.email)
        if existing_email:
            if existing_email.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Email ya registrado")
            else:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "INACTIVE_DUPLICATE",
                        "message": "El usuario existe pero está inactivo.",
                        "id": str(existing_email.id)
                    }
                )

        # Verificar si el username ya está registrado
        existing_username = await self.repo.get_by_username(payload.username)
        if existing_username:
            if existing_username.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Username ya registrado")
            else:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "INACTIVE_DUPLICATE",
                        "message": "El usuario existe pero está inactivo.",
                        "id": str(existing_username.id)
                    }
                )

        # Verificar si el número de identificación ya está registrado
        if payload.identification_number:
            existing_id = await self.repo.get_by_identification_number(payload.identification_number)
            if existing_id:
                if existing_id.is_active:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST, detail="El número de identificación ya está registrado")
                else:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={
                            "code": "INACTIVE_DUPLICATE",
                            "message": "El usuario existe pero está inactivo.",
                            "id": str(existing_id.id)
                        }
                    )

        permissions = payload.permissions
        if payload.is_admin:
            permissions = ALL_PERMISSIONS
        else:
            permissions = BASIC_PERMISSIONS

        # Crear el usuario
        user = User(
            email=payload.email,
            username=payload.username,
            password=hash_password(payload.password),
            permissions=permissions,
            is_admin=payload.is_admin,
            first_name=payload.first_name,
            last_name=payload.last_name,
            identification_number=payload.identification_number,
            phone=payload.phone,
            birth_date=payload.birth_date,
            
            identification_type_id=payload.identification_type_id,
            city_id=payload.city_id,
            address=payload.address,

            is_verified=is_verified
        )

        created_user = await self.repo.create(user)

        # Enviar email de verificación solo si no está verificado
        if not is_verified:
            token_data = {"sub": created_user.email, "type": "verification"}
            verification_token, _ = create_access_token(data=token_data)
            await EmailService().send_verification_email(created_user.email, verification_token)

        # Retornar el usuario creado
        return created_user

    # Reenviar email de verificación
    async def resend_verification_email(self, identifier: str) -> bool:
        # Try by email
        user = await self.repo.get_by_email(identifier)
        # If not found, try by username
        if not user:
            user = await self.repo.get_by_username(identifier)

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

        if user.is_verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="La cuenta ya está verificada")

        token_data = {"sub": user.email, "type": "verification"}
        verification_token, _ = create_access_token(data=token_data)
        await EmailService().send_verification_email(user.email, verification_token)
        return True

    # Registra un login exitoso; un fallo se loguea y nunca rompe el login
    async def record_login(self, user_id: uuid.UUID) -> None:
        try:
            await self.repo.touch_login(user_id, datetime.now())
        except Exception:
            logger.warning("Could not record last login of user %s", user_id, exc_info=True)
            try:
                await self.repo.db.rollback()
            except Exception:
                pass

    # Login de un usuario
    async def login(self, username: str, password: str) -> Dict[str, Any]:

        # Verificar si el usuario existe
        user = await self.repo.get_by_username(username)

        # Se verifica que el usuario exista y que la contraseña sea correcta
        if not user or not verify_password(password, user.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")

        if not user.is_verified:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Cuenta no verificada. Por favor revisa tu email.")

        # Se genera el payload del usuario
        user_login = {
            "id": str(user.id), # Convert UUID to info compatible string
            "username": user.username,
        }

        # Generar el token
        token, expire = create_access_token(data=user_login)
        refresh_token, refresh_expire = create_refresh_token(data=user_login)
        # Last: a failed touch rolls back and would expire `user`.
        await self.record_login(user.id)
        return {
            "access_token": token,
            "expires_at": expire,
            "refresh_token": refresh_token,
            "refresh_expires_at": refresh_expire
        }

    async def get_by_id(self, user_id: uuid.UUID) -> Optional[User]:
        user = await self.repo.get_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El usuario no se encontró"
            )
        return user

    async def get_all(
        self,
        page: int = 1,
        per_page: int = 10,
        is_active: Optional[bool] = None,
        is_admin: Optional[bool] = None,
        search: Optional[str] = None,
        sort: SortSpec = ()
    ) -> dict:
        result = await self.repo.get_all(
            page=page,
            per_page=per_page,
            is_active=is_active,
            is_admin=is_admin,
            search=search,
            sort=sort
        )

        # Convert SQLModel objects to Pydantic models with aliases (camelCase)
        # We use UserReadExtended to ensure all fields including computed ones are available
        # and standard User fields are aliased correctly.
        from app.api.auth.models import UserReadExtended
        
        items = []
        for user in result.get("items", []):
            # Validate creates the Pydantic model from the DB object
            user_model = UserReadExtended.model_validate(user)
            # Dump by alias ensures firstName, lastName etc. are used as keys
            items.append(user_model.model_dump(by_alias=True))

        result["items"] = items
        return result

    async def get_by_email(self, email: str) -> Optional[User]:
        return await self.repo.get_by_email(email)

    async def get_by_username(self, username: str) -> Optional[User]:
        return await self.repo.get_by_username(username)

    async def update(self, user_id: uuid.UUID, user_update: UserUpdate) -> Optional[User]:
        # Si se actualiza la contraseña, hay que hashearla
        # Solo si contiene caracteres (no vacío o solo espacios)
        if user_update.password and user_update.password.strip():
            validate_password_policy(user_update.password)
            user_update.password = hash_password(user_update.password)
        else:
            # Si viene vacío, lo ponemos como None para que no se incluya en la actualización
            user_update.password = None

        # Se verifica que el email no esté registrado
        if user_update.email:
            existing_user = await self.repo.get_by_email(user_update.email)
            if existing_user and existing_user.id != user_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Email ya registrado"
                )

        # Se verifica que el username no esté registrado
        if user_update.username:
            existing_user = await self.repo.get_by_username(user_update.username)
            if existing_user and existing_user.id != user_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Username ya registrado"
                )

        return await self.repo.update(user_id, user_update)

    async def delete(self, user_id: uuid.UUID) -> dict:
        success = await self.repo.delete(user_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El usuario no se encontró"
            )
        return {"message": "Usuario eliminado exitosamente"}

    async def change_password(self, user_id: uuid.UUID, new_password: str) -> Optional[User]:
        validate_password_policy(new_password)
        user = await self.repo.get_by_id(user_id)
        if not user:
            return None

        user.password = hash_password(new_password)
        user.must_change_password = False
        user.updated_at = datetime.now()

        # Once OAuth user sets a password, they're no longer purely OAuth
        if user.is_social_auth:
            user.is_social_auth = False

        self.repo.db.add(user)
        await self.repo.db.commit()
        await self.repo.db.refresh(user)

        return user

    def renew_token(self, user: User) -> Dict[str, Any]:
        user_login = {
            "id": str(user.id),
            "username": user.username,
        }
        token, expire = create_access_token(data=user_login)
        refresh_token, refresh_expire = create_refresh_token(data=user_login)
        return {
            "access_token": token,
            "expires_at": expire,
            "refresh_token": refresh_token,
            "refresh_expires_at": refresh_expire
        }

    async def verify_email(self, token: str) -> bool:
        try:
            payload = decode_token(token)
            data = payload.get("data", {})
            email = data.get("sub")
            token_type = data.get("type")

            if not email or token_type != "verification":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Token inválido")

            user = await self.repo.get_by_email(email)
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

            if user.is_verified:
                return True

            # Update validation status
            user_update = UserUpdate(is_verified=True)
            await self.repo.update(user.id, user_update)
            return True

        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Token inválido o expirado")

    async def forgot_password(self, email: str) -> bool:
        user = await self.repo.get_by_email(email)
        if not user:
            # Por seguridad, no indicamos si el email existe o no
            return True

        # Generar token de reseteo (validez 5 minutos)
        from datetime import timedelta
        reset_token_expires = timedelta(minutes=5)
        token_data = {"sub": user.email, "type": "reset_password"}
        reset_token, _ = create_access_token(
            data=token_data, expires_delta=reset_token_expires)

        # Enviar email
        await EmailService().send_password_reset_email(user.email, user.username, reset_token)
        return True

    async def reset_password(self, token: str, new_password: str) -> bool:
        validate_password_policy(new_password)
        try:
            payload = decode_token(token)
            data = payload.get("data", {})
            email = data.get("sub")
            token_type = data.get("type")

            if not email or token_type != "reset_password":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Token inválido")

            user = await self.repo.get_by_email(email)
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

            # Actualizar contraseña
            user.password = hash_password(new_password)
            # Opcional: invalidar tokens anteriores o marcar que ya no debe cambiar contraseña si estaba pendiente
            user.must_change_password = False
            user.updated_at = datetime.now()

            self.repo.db.add(user)
            await self.repo.db.commit()

            return True

        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Token inválido o expirado")

    async def verify_reset_token(self, token: str) -> bool:
        try:
            payload = decode_token(token)
            data = payload.get("data", {})
            email = data.get("sub")
            token_type = data.get("type")

            if not email or token_type != "reset_password":
                return False

            user = await self.repo.get_by_email(email)
            if not user:
                return False

            return True

        except Exception:
            return False

    async def get_or_create_social_user(self, email: str, first_name: str = "", last_name: str = "") -> User:
        # 1. Buscar si ya existe por email
        user = await self.repo.get_by_email(email)
        if user:
            return user

        # 2. Si no existe, crear uno nuevo
        import uuid
        random_password = f"SocialA1-{uuid.uuid4()}"
        validate_password_policy(random_password)

        # Generar username único basado en el email
        base_username = email.split("@")[0]
        username = base_username
        counter = 1
        while await self.repo.get_by_username(username):
            username = f"{base_username}{counter}"
            counter += 1

        permissions = BASIC_PERMISSIONS

        new_user = User(
            email=email,
            username=username,
            password=hash_password(random_password),
            permissions=permissions,
            is_verified=True,  # Social users are verified by provider
            must_change_password=False,
            is_social_auth=True,  # Mark as OAuth user
            is_active=True,
            first_name=first_name,
            last_name=last_name
        )

        new_user = await self.repo.create(new_user)
        return new_user
