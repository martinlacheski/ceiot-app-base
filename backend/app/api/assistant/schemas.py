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
