import uuid
from typing import Optional
from datetime import datetime
from sqlmodel import Field, SQLModel, func

class IdentificationTypeBase(SQLModel):
    name: str = Field(unique=True, index=True)
    is_active: bool = Field(default=True)

class IdentificationType(IdentificationTypeBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})

class IdentificationTypeCreate(IdentificationTypeBase):
    pass

class IdentificationTypeUpdate(SQLModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None

class IdentificationTypeRead(IdentificationTypeBase):
    id: uuid.UUID
