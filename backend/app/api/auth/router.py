from app.api.auth.models import UserRead, UserUpdate, User, UserPasswordUpdate, LoginResponse, UserRegistration, UserReadExtended
from typing import Optional
import uuid
from urllib.parse import quote, urlsplit
from app.api.auth.service import AuthService
from app.api.auth.repository import UserRepository
from app.core.dependencies import AsyncDBSession, PermissionChecker
from typing import Annotated
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import RedirectResponse
from fastapi import APIRouter, Depends, HTTPException, status, Request, Response, Cookie
from pydantic import BaseModel, EmailStr
from app.api.auth.models import ForgotPasswordRequest, ResetPasswordRequest
from app.core.config import settings
from fastapi_sso.sso.google import GoogleSSO
from fastapi_sso.sso.facebook import FacebookSSO
from app.core.permissions import PERMISSIONS_TREE, BASIC_PERMISSIONS
from app.core.security import decode_token
from app.core.sorting import parse_sort


USER_SORT_FIELDS = {
    "username": "username",
    "email": "email",
    "firstName": "firstName",
    "lastName": "lastName",
    "identificationNumber": "identificationNumber",
    "isActive": "isActive",
    "isAdmin": "isAdmin",
    "createdAt": "createdAt",
    "lastLoginAt": "lastLoginAt",
    "lastSeenAt": "lastSeenAt",
    # Preserve the previously accepted backend spellings.
    "is_active": "isActive",
    "is_admin": "isAdmin",
}

def _build_api_url() -> str:
    if settings.BACKEND_PUBLIC_BASE_URL:
        return settings.BACKEND_PUBLIC_BASE_URL.rstrip("/")

    host = settings.BACKEND_HOST_URL.rstrip("/")
    port = str(settings.BACKEND_PORT).strip()

    if not port:
        return host

    return f"{host}:{port}"


# Helper to get callback URL (adjust domain in production)
# API_URL = _build_api_url()
API_URL = settings.BACKEND_HOST_URL

facebook_sso = FacebookSSO(
    client_id=settings.FACEBOOK_CLIENT_ID or "missing",
    client_secret=settings.FACEBOOK_CLIENT_SECRET or "missing",
    redirect_uri=f"{API_URL}/api/auth/facebook/callback",
    allow_insecure_http=True
)


router = APIRouter(prefix="/auth", tags=["Auth"])


SELF_UPDATE_FIELDS = {
    "email",
    "username",
    "first_name",
    "last_name",
    "identification_number",
    "phone",
    "birth_date",
    "identification_type_id",
    "city_id",
    "address",
}


def _google_credentials() -> tuple[str, str]:
    client_id = (settings.GOOGLE_CLIENT_ID or "").strip()
    client_secret = (settings.GOOGLE_CLIENT_SECRET or "").strip()
    return client_id, client_secret


def _google_oauth_is_configured() -> bool:
    client_id, client_secret = _google_credentials()
    return bool(settings.GOOGLE_OAUTH_ENABLED and client_id and client_secret)


def _require_google_oauth() -> None:
    if not _google_oauth_is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not available.",
        )


def _google_origin_with_local_port(base_url: str, configured_port: str | int) -> str:
    origin = base_url.rstrip("/")
    parsed = urlsplit(origin)
    hostname = (parsed.hostname or "").lower()
    port = str(configured_port).strip()

    if hostname not in {"localhost", "127.0.0.1", "::1"} or not port:
        return origin
    if parsed.port is not None:
        return origin
    if (parsed.scheme == "http" and port == "80") or (
        parsed.scheme == "https" and port == "443"
    ):
        return origin
    return f"{origin}:{port}"


def _google_backend_origin() -> str:
    public_base = settings.BACKEND_PUBLIC_BASE_URL or ""
    if public_base.strip():
        return public_base.rstrip("/")
    return _google_origin_with_local_port(
        settings.BACKEND_HOST_URL,
        settings.BACKEND_PORT,
    )


def _google_frontend_origin() -> str:
    return _google_origin_with_local_port(
        settings.VITE_FRONTEND_URL,
        settings.VITE_FRONTEND_PORT,
    )


def _google_callback_url() -> str:
    return f"{_google_backend_origin()}/api/auth/google/callback"


def _google_success_url(next_path: str | None = None) -> str:
    base_url = f"{_google_frontend_origin()}/auth/social-callback"
    safe_next = _safe_frontend_return_path(next_path)
    if safe_next:
        return f"{base_url}?next={quote(safe_next, safe='')}"
    return base_url


def _google_error_url() -> str:
    return f"{_google_frontend_origin()}/auth/login?error=social_auth_failed"


def _google_sso_client() -> GoogleSSO:
    client_id, client_secret = _google_credentials()
    return GoogleSSO(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=_google_callback_url(),
        allow_insecure_http=True,
    )


def _safe_frontend_return_path(value: str | None) -> str | None:
    if not value:
        return None
    if not value.startswith("/") or value.startswith("//"):
        return None
    return value


def _social_callback_url(next_path: str | None = None) -> str:
    base_url = f"{settings.VITE_FRONTEND_URL}/auth/social-callback"
    safe_next = _safe_frontend_return_path(next_path)
    if safe_next:
        return f"{base_url}?next={quote(safe_next, safe='')}"
    return base_url


# Endpoint para obtener los datos del usuario actual
@router.get("/me", response_model=UserReadExtended)
async def get_current_user(current_user: User = Depends(PermissionChecker("user:me"))):
    return current_user


# Endpoint para registrar un nuevo usuario (público)
@router.post("/register",
             response_model=UserReadExtended,
             status_code=status.HTTP_201_CREATED
             )
async def register_user(payload: UserRegistration, db: AsyncDBSession):
    user_repo = UserRepository(db)

    # 1. Crear el Usuario
    service = AuthService(user_repo)

    # Extraer los campos del usuario
    # UserCreate/UserRegistration now has all fields
    # Just pass payload to create
    # Note: Service create handles email/username checks and hashing

    user = await service.create(payload)
    return user


# Endpoint para verificar email
@router.get("/verify-email", status_code=status.HTTP_200_OK)
async def verify_email(token: str, db: AsyncDBSession):
    service = AuthService(UserRepository(db))
    await service.verify_email(token)
    return {"message": "Email verificado exitosamente"}


# Endpoint para reenviar email de verificación
class ResendVerificationRequest(BaseModel):
    identifier: str


@router.post("/resend-verification", status_code=status.HTTP_200_OK)
async def resend_verification(payload: ResendVerificationRequest, db: AsyncDBSession):
    service = AuthService(UserRepository(db))
    await service.resend_verification_email(payload.identifier)
    return {"message": "Email de verificación reenviado"}


# Endpoint para solicitar reseteo de contraseña
@router.post("/forgot-password", status_code=status.HTTP_200_OK)
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncDBSession):
    service = AuthService(UserRepository(db))
    await service.forgot_password(payload.email)
    return {"message": "Si el email existe, se ha enviado un correo para restablecer la contraseña"}


@router.get("/verify-reset-token/{token}", status_code=status.HTTP_200_OK)
async def verify_reset_token(token: str, db: AsyncDBSession):
    service = AuthService(UserRepository(db))
    is_valid = await service.verify_reset_token(token)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Token inválido o expirado"
        )
    return {"valid": is_valid}


# Endpoint para resetear la contraseña
@router.post("/reset-password", status_code=status.HTTP_200_OK)
async def reset_password(payload: ResetPasswordRequest, db: AsyncDBSession):
    service = AuthService(UserRepository(db))
    if payload.new_password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Las contraseñas no coinciden"
        )

    # Verificar token
    if not await service.reset_password(payload.token, payload.new_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token inválido o expirado"
        )

    return {"message": "Contraseña actualizada exitosamente"}


# --------------------------------------------------------------------------
# SOCIAL AUTH ENDPOINTS
# --------------------------------------------------------------------------

@router.get("/providers")
async def auth_providers():
    return {"google": _google_oauth_is_configured()}


@router.get("/google/login")
async def google_login(next: str | None = None):
    """Initiates Google OAuth2 login flow."""
    _require_google_oauth()
    google_sso = _google_sso_client()
    return await google_sso.get_login_redirect(state=_safe_frontend_return_path(next))


@router.get("/google/callback")
async def google_callback(request: Request, db: AsyncDBSession):
    """Handles Google OAuth2 callback."""
    _require_google_oauth()
    try:
        google_sso = _google_sso_client()
        service = AuthService(UserRepository(db))
        sso_user = await google_sso.verify_and_process(request)

        if not sso_user.email:
            raise HTTPException(
                status_code=400, detail="El email no fue proporcionado por Google")

        user_db = await service.get_or_create_social_user(email=sso_user.email, first_name=sso_user.first_name, last_name=sso_user.last_name)
        token_data = service.renew_token(user_db)
        await service.record_login(user_db.id)

        next_path = _safe_frontend_return_path(request.query_params.get("state"))
        response = RedirectResponse(
            _google_success_url(next_path),
            status_code=303
        )
        is_secure = settings.ENVIRONMENT == "PROD"
        response.set_cookie(
            key="refresh_token",
            value=token_data["refresh_token"],
            httponly=True,
            secure=is_secure,
            samesite="lax",
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
        )
        return response

    except Exception:
        return RedirectResponse(
            _google_error_url(),
            status_code=303
        )


@router.get("/facebook/login")
async def facebook_login(next: str | None = None):
    """Initiates Facebook OAuth2 login flow"""
    return await facebook_sso.get_login_redirect(state=_safe_frontend_return_path(next))


@router.get("/facebook/callback")
async def facebook_callback(request: Request, db: AsyncDBSession):
    """Handles Facebook OAuth2 callback"""
    try:
        service = AuthService(UserRepository(db))
        sso_user = await facebook_sso.verify_and_process(request)

        if not sso_user.email:
            raise HTTPException(
                status_code=400, detail="El email no fue proporcionado por Facebook")

        user_db = await service.get_or_create_social_user(email=sso_user.email, first_name=sso_user.first_name, last_name=sso_user.last_name)
        token_data = service.renew_token(user_db)
        await service.record_login(user_db.id)

        next_path = _safe_frontend_return_path(request.query_params.get("state"))
        response = RedirectResponse(
            _social_callback_url(next_path),
            status_code=303
        )
        is_secure = settings.ENVIRONMENT == "PROD"
        response.set_cookie(
            key="refresh_token",
            value=token_data["refresh_token"],
            httponly=True,
            secure=is_secure,
            samesite="lax",
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
        )
        return response

    except Exception as e:
        return RedirectResponse(
            f"{settings.VITE_FRONTEND_URL}/auth/login?error=social_auth_failed",
            status_code=303
        )


# Endpoint para verificar disponibilidad de username
@router.get("/check-username/{username}", tags=["Availability"])
async def check_username_availability(username: str, db: AsyncDBSession):
    user_repo = UserRepository(db)
    service = AuthService(user_repo)
    user = await service.get_by_username(username)
    return {"available": user is None}


# Endpoint para verificar disponibilidad de email
@router.get("/check-email/{email}", tags=["Availability"])
async def check_email_availability(email: str, db: AsyncDBSession):
    user_repo = UserRepository(db)
    service = AuthService(user_repo)
    user = await service.get_by_email(email)
    return {"available": user is None}


# Endpoint para verificar disponibilidad de identificación
@router.get("/check-identification/{identification_number}", tags=["Availability"])
async def check_identification_availability(identification_number: str, db: AsyncDBSession):
    user_repo = UserRepository(db)
    person = await user_repo.get_by_identification_number(identification_number)
    return {"available": person is None}


# Endpoint to fetch available permissions (dynamic from backend components)
@router.get("/permissions", response_model=dict)
async def get_permissions(current_user: User = Depends(PermissionChecker("user:me"))):
    return {
        "groups": list(PERMISSIONS_TREE.values()),
        "basic_permissions": BASIC_PERMISSIONS
    }


# Endpoint para crear un nuevo usuario
@router.post("/create",
             response_model=UserReadExtended,
             status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(PermissionChecker("user:create"))]
             )
async def create_user(payload: UserRegistration, db: AsyncDBSession):
    user_repo = UserRepository(db)

    # 1. Crear el Usuario
    service = AuthService(user_repo)

    # Extraer los campos del usuario
    user = await service.create(payload, is_verified=True)
    return user


# Endpoint para obtener todos los usuarios
@router.get("/",
            response_model=dict,
            dependencies=[Depends(PermissionChecker("user:read"))]
            )
async def get_all_users(
    db: AsyncDBSession,
    page: int = 1,
    per_page: int = 10,
    is_active: Optional[bool] = None,
    is_admin: Optional[bool] = None,
    search: Optional[str] = None,
    sort: Optional[str] = None
):
    parsed_sort = parse_sort(sort, USER_SORT_FIELDS, max_fields=8)
    service = AuthService(UserRepository(db))
    return await service.get_all(page, per_page, is_active, is_admin, search, parsed_sort)


# Endpoint para verificar el estado de la sesión
@router.get("/check-status", response_model=LoginResponse)
async def check_status(db: AsyncDBSession, current_user: User = Depends(PermissionChecker("user:me"))):
    service = AuthService(UserRepository(db))
    token_data = service.renew_token(current_user)

    return {
        "access_token": token_data["access_token"],
        "token_type": "bearer",
        "expires_at": token_data["expires_at"],
        "user": current_user
    }


# Endpoint para obtener un usuario por su ID
@router.get("/{user_id}",
            response_model=UserReadExtended,
            dependencies=[Depends(PermissionChecker("user:read"))]
            )
async def get_user_by_id(user_id: uuid.UUID, db: AsyncDBSession):
    service = AuthService(UserRepository(db))
    user = await service.get_by_id(user_id)
    return user


# Endpoint para actualizar un usuario


@router.put("/update/{user_id}", response_model=UserReadExtended)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: AsyncDBSession,
    current_user: User = Depends(PermissionChecker("user:me"))
):
    requested_fields = payload.model_fields_set
    can_update_users = "user:update" in (current_user.permissions or [])

    if current_user.id == user_id and not can_update_users:
        if requested_fields - SELF_UPDATE_FIELDS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para actualizar campos privilegiados",
            )
    elif current_user.id != user_id:
        PermissionChecker("user:update")(current_user)

    if "is_admin" in requested_fields and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un administrador puede cambiar el rol de administrador",
        )

    user_repo = UserRepository(db)
    service = AuthService(user_repo)

    # Check identification uniqueness if changed?
    if payload.identification_number:
        existing = await user_repo.get_by_identification_number(payload.identification_number)
        if existing and existing.id != user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="El número de identificación ya está registrado")

    updated_user = await service.update(user_id, payload)
    if not updated_user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    # Return mapped
    return updated_user


# Endpoint para eliminar lógicamenteun usuario
@router.delete("/delete/{user_id}",
               dependencies=[Depends(PermissionChecker("user:delete"))]
               )
async def delete_user(user_id: uuid.UUID, db: AsyncDBSession):
    service = AuthService(UserRepository(db))
    return await service.delete(user_id)


# Endpoint para cambiar la contraseña de un usuario
@router.patch("/password", response_model=UserReadExtended)
async def change_password(payload: UserPasswordUpdate,
                          db: AsyncDBSession,
                          current_user: User = Depends(
                              PermissionChecker("user:password"))
                          ):
    service = AuthService(UserRepository(db))
    from app.core.security import verify_password

    # For OAuth users setting password for the first time, old password is not required
    if current_user.is_social_auth and not payload.old_password:
        # OAuth user setting password for the first time - no validation needed
        pass
    elif not payload.old_password:
        # Non-OAuth user must provide old password
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Debes ingresar tu contraseña actual"
        )
    elif not verify_password(payload.old_password, current_user.password):
        # Validate old password if provided
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Contraseña anterior incorrecta")

    if payload.new_password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Las contraseñas ingresadas no coinciden")

    # The service handles hashing and updating is_social_auth/must_change_password
    updated_user = await service.change_password(current_user.id, payload.new_password)

    # Return mapped user
    return updated_user


# Endpoint para iniciar sesión
@router.post("/login", response_model=LoginResponse)
async def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: AsyncDBSession,
    response: Response
):
    service = AuthService(UserRepository(db))
    token_data = await service.login(form_data.username, form_data.password)

    # Establecer Refresh Token como HttpOnly Cookie
    # Secure solo en PROD (o si usas HTTPS localmente)
    is_secure = settings.ENVIRONMENT == "PROD"
    
    response.set_cookie(
        key="refresh_token",
        value=token_data["refresh_token"],
        httponly=True,
        secure=is_secure, 
        samesite="lax", 
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
    )

    # Obtener el usuario
    user = await service.get_by_username(form_data.username)

    return {
        "access_token": token_data["access_token"],
        "token_type": "bearer",
        "expires_at": token_data["expires_at"],
        "user": user
    }


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    response: Response,
    db: AsyncDBSession,
    refresh_token: str = Cookie(None)
):
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Refresh token missing")

    try:
        payload = decode_token(refresh_token, verify_type="refresh")
        user_data = payload.get("data")
        username = user_data.get("username")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    service = AuthService(UserRepository(db))
    user = await service.get_by_username(username)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Renew tokens
    token_data = service.renew_token(user)

    # Update Refresh Cookie
    is_secure = settings.ENVIRONMENT == "PROD"
    
    response.set_cookie(
        key="refresh_token",
        value=token_data["refresh_token"],
        httponly=True,
        secure=is_secure,
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
    )

    return {
        "access_token": token_data["access_token"],
        "token_type": "bearer",
        "expires_at": token_data["expires_at"],
        "user": user
    }


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("refresh_token")
    return {"message": "Logged out successfully"}
