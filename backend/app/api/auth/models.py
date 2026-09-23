
from datetime import datetime, date
from typing import List, Optional
import uuid
from sqlmodel import Field, SQLModel, Column, JSON, text, Relationship, func
from pydantic import BaseModel, EmailStr, field_validator

from app.core.security import validate_password_policy

# Import related models for foreign keys (if needed for type checking, or use strings)
# We will use string forward references for relationships to avoid circular imports if any.

# Modelo de usuario
class User(SQLModel, table=True):
    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    email: str = Field(index=True, unique=True)
    username: str = Field(index=True, unique=True)
    password: str

    first_name: str = Field(default="")
    last_name: str = Field(default="")

    # Foreign Keys
    identification_type_id: Optional[uuid.UUID] = Field(default=None, foreign_key="identificationtype.id")
    identification_number: Optional[str] = Field(default=None, index=True)
    
    city_id: Optional[uuid.UUID] = Field(default=None, foreign_key="locationcity.id")
    address: Optional[str] = None

    phone: Optional[str] = None
    birth_date: Optional[date] = None

    permissions: list[str] = Field(default=[], sa_column=Column(JSON))
    created_at: datetime = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})
    is_active: bool = Field(default=True)
    is_verified: bool = Field(default=False, sa_column_kwargs={
                              "server_default": text("false")})
    is_admin: bool = Field(default=False)
    must_change_password: bool = Field(default=True)
    is_social_auth: bool = Field(default=False)
    
    # Relationships
    # identification_type: Optional["IdentificationType"] = Relationship()
    # city: Optional["LocationCity"] = Relationship()


from app.core.utils import CamelModel

##### DTOs #####

# Modelo base para campos comunes de usuario
class UserBase(SQLModel):
    email: str
    username: str
    permissions: List[str] = []
    is_admin: bool = False
    first_name: str = ""
    last_name: str = ""
    identification_number: Optional[str] = None
    phone: Optional[str] = None
    birth_date: Optional[date] = None
    identification_type_id: Optional[uuid.UUID] = None
    city_id: Optional[uuid.UUID] = None
    address: Optional[str] = None


# Modelo de usuario para Login
class UserLogin(SQLModel):
    username: str
    password: str


# Modelo de usuario para crear
class UserCreate(UserBase):
    password: str

    _validate_password = field_validator("password")(validate_password_policy)


# Modelo de usuario para Registrar
class UserRegistration(UserCreate):
    pass


# Modelo de usuario para leer
class UserRead(CamelModel):
    id: uuid.UUID
    email: str
    username: str
    permissions: List[str]
    created_at: datetime
    updated_at: Optional[datetime] = None
    is_active: bool
    is_verified: bool
    is_admin: bool
    must_change_password: bool
    is_social_auth: bool

    first_name: str
    last_name: str
    identification_number: Optional[str] = None
    birth_date: Optional[date] = None
    phone: Optional[str] = None
    
    identification_type_id: Optional[uuid.UUID] = None
    city_id: Optional[uuid.UUID] = None
    address: Optional[str] = None

    # model_config is already in CamelModel with from_attributes=True


class UserReadExtended(UserRead):
    # Campos adicionales si los hubiera, pero ya no necesitamos definir alias manuales
    pass


class UserUpdate(SQLModel):
    email: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    permissions: Optional[List[str]] = None
    updated_at: datetime = Field(default_factory=datetime.now)
    is_active: Optional[bool] = None
    is_verified: Optional[bool] = None
    is_admin: Optional[bool] = None

    first_name: Optional[str] = None
    last_name: Optional[str] = None
    identification_number: Optional[str] = None
    phone: Optional[str] = None
    birth_date: Optional[date] = None
    
    identification_type_id: Optional[uuid.UUID] = None
    city_id: Optional[uuid.UUID] = None
    address: Optional[str] = None

    @field_validator("password")
    @classmethod
    def validate_optional_password(cls, password: Optional[str]) -> Optional[str]:
        if password is None or not password.strip():
            return None
        return validate_password_policy(password)


class UserPasswordUpdate(SQLModel):
    old_password: Optional[str] = None
    new_password: str
    confirm_password: str
    updated_at: datetime = Field(default_factory=datetime.now)

    _validate_new_password = field_validator("new_password")(
        validate_password_policy
    )


class LoginResponse(SQLModel):
    user: UserReadExtended
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
    confirm_password: str

    _validate_new_password = field_validator("new_password")(
        validate_password_policy
    )
