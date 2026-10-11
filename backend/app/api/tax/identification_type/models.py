import uuid
from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel, func
from app.core.time import UTCDateTime

class IdentificationTypeBase(SQLModel):
    name: str = Field(unique=True, index=True)
    is_active: bool = Field(default=True)

class IdentificationType(IdentificationTypeBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    updated_at: Optional[datetime] = Field(default=None, sa_type=UTCDateTime, sa_column_kwargs={"onupdate": func.now()})
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now()),
    )

class IdentificationTypeCreate(IdentificationTypeBase):
    pass

class IdentificationTypeUpdate(SQLModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None

class IdentificationTypeRead(IdentificationTypeBase):
    id: uuid.UUID
