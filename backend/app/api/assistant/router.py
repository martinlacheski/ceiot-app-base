"""Assistant API: text-to-SQL over the curated ``ai_read`` views (R3) and RAG over the documents (R4).

Order of checks: authentication and ``telemetry:read`` -> configured (503) ->
per-user rate limit (429) -> flow. The audit row is written by the service.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError

from app.api.assistant.rate_limit import check_rate_limit
from app.api.assistant.rag import RagService, get_rag_service
from app.api.assistant.schemas import (
    AssistantRagRequest,
    AssistantRagResponse,
    AssistantSQLRequest,
    AssistantSQLResponse,
)
from app.api.assistant.service import AssistantService, DbAuditSink, Unanswerable
from app.api.assistant.sql_executor import QueryFailed, execute_validated_sql, identity_for
from app.api.assistant.sql_guard import SQLRejected, ValidatedSQL
from app.api.assistant.sql_schema import schema_prompt
from app.api.auth.models import User
from app.api.sensor_catalog.permissions import SensorCatalogPermissions
from app.core.db import async_engine
from app.core.dependencies import AuthedAsyncDBSession, PermissionChecker, get_current_user
from app.core.embeddings import EmbeddingError, EmbeddingNotConfigured
from app.core.llm import LLMError, LLMNotConfigured, get_llm_client

logger = logging.getLogger(__name__)

router = APIRouter()

require_telemetry_read = PermissionChecker(SensorCatalogPermissions.TELEMETRY_READ)


def get_assistant_service(
    session: AuthedAsyncDBSession, user: User = Depends(require_telemetry_read)
) -> AssistantService:
    try:
        llm = get_llm_client()
    except LLMNotConfigured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Asistente no configurado") from None
    identity = identity_for(user)

    async def run_sql(validated: ValidatedSQL):
        return await execute_validated_sql(async_engine, identity, validated)

    async def load_schema():
        return await schema_prompt(async_engine, identity)

    return AssistantService(llm=llm, run_sql=run_sql, load_schema=load_schema, audit=DbAuditSink(session, user.id))


@router.post("/sql", response_model=AssistantSQLResponse)
async def ask_sql(
    body: AssistantSQLRequest,
    user: User = Depends(require_telemetry_read),
    service: AssistantService = Depends(get_assistant_service),
):
    retry_after = await check_rate_limit(str(user.id))
    if retry_after is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Demasiadas consultas al asistente; esperá un momento e intentá de nuevo.",
            headers={"Retry-After": str(retry_after)},
        )
    try:
        answer = await service.ask(body.question)
    except SQLRejected as rejected:
        detail = rejected.public_message
        if user.is_admin:  # administrators may see why; nobody sees the raw SQL here (it is in the audit log)
            detail = f"{detail} Motivo: {rejected.reason}."
        raise HTTPException(422, detail) from None
    except Unanswerable as unanswerable:
        raise HTTPException(422, unanswerable.public_message) from None
    except LLMNotConfigured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Asistente no configurado") from None
    except LLMError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "El proveedor de IA no pudo completar la solicitud") from None
    except QueryFailed as failed:
        if failed.code == "timeout":
            raise HTTPException(
                status.HTTP_504_GATEWAY_TIMEOUT,
                "La consulta tardó demasiado; acotá el período, el equipo o la variable.",
            ) from None
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Asistente no disponible") from None
    return answer


RATE_LIMITED = "Demasiadas consultas al asistente; esperá un momento e intentá de nuevo."


@router.post("/rag", response_model=AssistantRagResponse)
async def ask_rag(
    body: AssistantRagRequest,
    user: User = Depends(get_current_user),
    service: RagService = Depends(get_rag_service),
):
    """Answer from the administrators' documents. Any authenticated user may ask: the documents the
    administrators mark active are company-wide content, and retrieval only ever sees those
    (see migration 0014); asking needs no telemetry permission."""
    retry_after = await check_rate_limit(f"rag:{user.id}")
    if retry_after is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, RATE_LIMITED, headers={"Retry-After": str(retry_after)}
        )
    try:
        return await service.ask(body.question, body.document_id)
    except (EmbeddingNotConfigured, LLMNotConfigured):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Asistente no configurado") from None
    except (EmbeddingError, LLMError):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "El proveedor de IA no pudo completar la solicitud") from None
    except SQLAlchemyError:
        logger.warning("RAG retrieval failed", exc_info=True)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Asistente no disponible") from None
