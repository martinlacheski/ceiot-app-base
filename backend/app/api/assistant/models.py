"""Audit row for every assistant question (see migration 0013 for the RLS policies)."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Text, func
from sqlmodel import Field, SQLModel


class AssistantQueryLog(SQLModel, table=True):
    __tablename__ = "assistant_query_log"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    question: str = Field(sa_column=Column(Text, nullable=False))
    generated_sql: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    validated: bool = False
    kind: str = Field(default="sql", max_length=16, sa_column_kwargs={"server_default": "sql"})
    error_code: str | None = Field(default=None, max_length=40)
    row_count: int | None = None
    duration_ms: int | None = None
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now()),
    )
