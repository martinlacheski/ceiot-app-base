import uuid
from typing import Annotated, Any, Literal

from pydantic import Field, StringConstraints

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


class AssistantChatTurn(CamelModel):
    role: Literal["user", "assistant"]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class AssistantChatRequest(CamelModel):
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]
    mode: Literal["auto", "datos", "documentos"] = "auto"
    # Untrusted, client-held context. Accepted generously and trimmed server-side to the last turns.
    history: list[AssistantChatTurn] = Field(default_factory=list, max_length=20)


class AssistantChatRoute(CamelModel):
    datos: bool
    documentos: bool
    mode: str


class AssistantChatSql(CamelModel):
    query: str
    columns: list[str]
    rows: list[dict[str, Any]]
    truncated: bool


class AssistantChatResponse(CamelModel):
    answer: str
    route: AssistantChatRoute
    sql: AssistantChatSql | None
    sources: list[AssistantRagSource]
    trace: list[str]
    warnings: list[str]
