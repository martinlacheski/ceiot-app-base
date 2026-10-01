"""SQLModel table for admin documents stored in object storage."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, CheckConstraint, Column, DateTime, ForeignKey, Text, func
from sqlmodel import Field, SQLModel



def utc_now() -> datetime:
    # timestamptz columns (see migration 0011), like the sensor catalog tables.
    return datetime.now(timezone.utc)


class Document(SQLModel, table=True):
    __tablename__ = "document"
    # Row Level Security (admin-only policy) is PostgreSQL-only DDL and lives
    # in migration 0011; it cannot be expressed here without breaking SQLite.
    __table_args__ = (
        CheckConstraint(
            "ingestion_status IN ('pending', 'processing', 'ready', 'failed')",
            name="ck_document_ingestion_status",
        ),
        CheckConstraint("size_bytes >= 0", name="ck_document_size_bytes"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    title: str = Field(sa_column=Column(Text, nullable=False))
    filename: str = Field(sa_column=Column(Text, nullable=False))
    content_type: str = Field(sa_column=Column(Text, nullable=False))
    size_bytes: int = Field(sa_column=Column(BigInteger, nullable=False))
    sha256: str = Field(max_length=64, unique=True, index=True)
    storage_key: str = Field(sa_column=Column(Text, nullable=False))
    uploaded_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True),
    )
    is_active: bool = True
    ingestion_status: str = Field(default="pending", max_length=16)
    ingested_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    error: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()),
    )
