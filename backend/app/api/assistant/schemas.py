import uuid
from typing import Annotated, Any

from pydantic import StringConstraints

from app.core.utils import CamelModel


class AssistantSQLRequest(CamelModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]


class AssistantSQLResponse(CamelModel):
    answer: str
    sql: str
    columns: list[str]
    rows: list[dict[str, Any]]
    truncated: bool
    trace: list[str]


class AssistantRagRequest(CamelModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]
    document_id: uuid.UUID | None = None


class AssistantRagSource(CamelModel):
    document_id: uuid.UUID
    title: str
    page: int | None
    section: str | None
    distance: float
    excerpt: str


class AssistantRagResponse(CamelModel):
    answer: str
    sources: list[AssistantRagSource]
    trace: list[str]
