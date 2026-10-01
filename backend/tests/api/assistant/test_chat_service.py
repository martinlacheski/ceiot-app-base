"""Chat orchestration with fakes: router plan parsing/fallback, permission gating, degradation, synthesis."""

import json
import uuid

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.api.assistant.chat import (
    DatosForbidden,
    ChatService,
    ChatTurn,
    parse_router_plan,
)
from app.api.assistant.rag import NO_EVIDENCE, RagAnswer, RagSource
from app.api.assistant.service import AssistantAnswer, AuditRecord, Unanswerable
from app.api.assistant.sql_executor import QueryFailed
from app.api.assistant.sql_guard import SQLRejected
from app.core.embeddings import EmbeddingNotConfigured
from app.core.llm import LLMError

PLAN = json.dumps({"datos": "temperatura promedio por día", "documentos": "precisión del DHT22"})


class FakeLLM:
    def __init__(self, replies=(), error=None):
        self.replies, self.error, self.calls = list(replies), error, []

    async def chat(self, messages, *, max_completion_tokens=None):
        self.calls.append(messages)
        if self.error:
            raise self.error
        return self.replies.pop(0)


class FakeDatos:
    def __init__(self, error=None):
        self.error, self.questions = error, []

    async def ask(self, question):
        self.questions.append(question)
        if self.error:
            raise self.error
        return AssistantAnswer(
            answer="Promedio 21,5 °C.",
            sql="SELECT 1 LIMIT 1",
            columns=["dia", "promedio"],
            rows=[{"dia": "2026-10-01", "promedio": 21.5}],
            truncated=False,
            trace=["esquema-database", "openrouter-sql"],
        )


class FakeDocs:
    def __init__(self, error=None, evidence=True):
        self.error, self.evidence, self.questions = error, evidence, []

    async def ask(self, question, document_id=None):
        self.questions.append(question)
        if self.error:
            raise self.error
        if not self.evidence:
            return RagAnswer(NO_EVIDENCE, [], ["pgvector-sin-evidencia"])
        src = RagSource(uuid.uuid4(), "Hoja de datos DHT22", 2, None, 0.31, "Precisión ±0,5 °C")
        return RagAnswer("Precisión de ±0,5 °C [Hoja de datos DHT22, p. 2].", [src], ["pgvector-top-1"])


class Sink:
    def __init__(self):
        self.records: list[AuditRecord] = []

    async def record(self, record):
        self.records.append(record)


def make(llm, *, datos=None, docs=None, can_datos=True, sink=None):
    return ChatService(
        llm=llm,
        datos=datos if datos is not None else FakeDatos(),
        documentos=docs if docs is not None else FakeDocs(),
        audit=sink or Sink(),
        can_datos=can_datos,
    )


# ---- router plan parsing (mirrors the reference _parse_orchestrator_plan) -----------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (PLAN, ("temperatura promedio por día", "precisión del DHT22")),
        ('{"datos": "x", "documentos": null}', ("x", None)),
        ('{"datos": null, "documentos": "y"}', (None, "y")),
        ('```json\n{"datos": "x", "documentos": null}\n```', ("x", None)),
    ],
)
def test_valid_plans(raw, expected):
    assert parse_router_plan(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "no es json",
        "[]",
        '{"datos": null, "documentos": null}',
        '{"datos": "x"}',
        '{"datos": "x", "documentos": null, "extra": 1}',
        '{"datos": 3, "documentos": null}',
        '{"datos": "", "documentos": null}',
        json.dumps({"datos": "x" * 501, "documentos": None}),
        'texto antes {"datos": "x", "documentos": null}',
    ],
)
def test_invalid_plans_return_none(raw):
    assert parse_router_plan(raw) is None


# ---- routing ---------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auto_routes_both_and_synthesizes_with_one_extra_call():
    llm = FakeLLM([PLAN, "Síntesis final."])
    datos, docs = FakeDatos(), FakeDocs()
    result = await make(llm, datos=datos, docs=docs).ask("¿temperatura y precisión?", "auto", [])
    assert datos.questions == ["temperatura promedio por día"] and docs.questions == ["precisión del DHT22"]
    assert result.answer == "Síntesis final." and len(llm.calls) == 2
    assert result.route.datos and result.route.documentos and result.route.mode == "auto"
    assert result.sql.columns == ["dia", "promedio"] and result.sources[0].title == "Hoja de datos DHT22"
    assert "orquestador" in result.trace and "síntesis" in result.trace
    synth = llm.calls[1][-1]["content"]
    assert "Promedio 21,5" in synth and "Hoja de datos DHT22" in synth


@pytest.mark.asyncio
async def test_synthesis_prompt_has_anti_fabrication_rules():
    llm = FakeLLM([PLAN, "ok"])
    await make(llm).ask("pregunta de ejemplo", "auto", [])
    system = llm.calls[1][0]["content"].lower()
    assert "no inventes" in system and "únicamente" in system and "no confiable" in system


@pytest.mark.asyncio
async def test_only_datos_returns_branch_answer_without_synthesis():
    llm = FakeLLM(['{"datos": "q", "documentos": null}'])
    docs = FakeDocs()
    result = await make(llm, docs=docs).ask("promedio de hoy", "auto", [])
    assert result.answer == "Promedio 21,5 °C." and len(llm.calls) == 1 and docs.questions == []
    assert result.route.documentos is False and result.sources == []


@pytest.mark.asyncio
async def test_only_documentos_returns_branch_answer_without_synthesis():
    llm = FakeLLM(['{"datos": null, "documentos": "q"}'])
    datos = FakeDatos()
    result = await make(llm, datos=datos).ask("precisión del sensor", "auto", [])
    assert result.answer.startswith("Precisión") and datos.questions == [] and result.sql is None


@pytest.mark.asyncio
async def test_invalid_plan_falls_back_to_both_with_the_original_question():
    llm = FakeLLM(["basura", "Síntesis."])
    datos, docs = FakeDatos(), FakeDocs()
    result = await make(llm, datos=datos, docs=docs).ask("pregunta original", "auto", [])
    assert datos.questions == ["pregunta original"] and docs.questions == ["pregunta original"]
    assert "orquestador-fallback" in result.trace and result.answer == "Síntesis."


@pytest.mark.asyncio
async def test_router_provider_error_falls_back_to_both():
    llm = FakeLLM(["x"], error=None)

    async def boom(messages, *, max_completion_tokens=None):
        llm.calls.append(messages)
        if len(llm.calls) == 1:
            raise LLMError("sk-secret")
        return "Síntesis."

    llm.chat = boom
    datos, docs = FakeDatos(), FakeDocs()
    result = await make(llm, datos=datos, docs=docs).ask("pregunta original", "auto", [])
    assert datos.questions == docs.questions == ["pregunta original"] and "orquestador-fallback" in result.trace


@pytest.mark.asyncio
async def test_router_prompt_carries_history_as_untrusted_data():
    llm = FakeLLM(['{"datos": null, "documentos": "q"}'])
    history = [ChatTurn(role="user", content="¿Y el DHT22?"), ChatTurn(role="assistant", content="Es un sensor")]
    await make(llm).ask("¿y su precisión?", "auto", history)
    prompt = llm.calls[0][-1]["content"]
    assert "¿Y el DHT22?" in prompt and "<HISTORIAL>" in prompt


@pytest.mark.asyncio
async def test_history_is_trimmed_to_six_turns():
    llm = FakeLLM(['{"datos": null, "documentos": "q"}'])
    history = [ChatTurn(role="user", content=f"turno-{i}") for i in range(10)]
    await make(llm).ask("pregunta de ejemplo", "auto", history)
    prompt = llm.calls[0][-1]["content"]
    assert "turno-3" not in prompt and "turno-4" in prompt and "turno-9" in prompt


@pytest.mark.parametrize(("mode", "datos_ran", "docs_ran"), [("datos", True, False), ("documentos", False, True)])
@pytest.mark.asyncio
async def test_mode_override_skips_router(mode, datos_ran, docs_ran):
    llm = FakeLLM([])
    datos, docs = FakeDatos(), FakeDocs()
    result = await make(llm, datos=datos, docs=docs).ask("pregunta de ejemplo", mode, [])
    assert llm.calls == [] and bool(datos.questions) is datos_ran and bool(docs.questions) is docs_ran
    assert result.route.mode == mode


# ---- permission gating -------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_without_telemetry_permission_auto_never_runs_datos_nor_the_router():
    llm = FakeLLM([])
    datos = FakeDatos()
    result = await make(llm, datos=datos, can_datos=False).ask("pregunta de ejemplo", "auto", [])
    assert datos.questions == [] and llm.calls == []
    assert result.route.datos is False and result.route.documentos is True and result.sql is None


@pytest.mark.asyncio
async def test_without_telemetry_permission_explicit_datos_is_forbidden():
    datos = FakeDatos()
    with pytest.raises(DatosForbidden):
        await make(FakeLLM([]), datos=datos, can_datos=False).ask("pregunta de ejemplo", "datos", [])
    assert datos.questions == []


# ---- degradation ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "error",
    [
        SQLRejected("no_select", "no es un SELECT"),
        Unanswerable(),
        QueryFailed("timeout"),
        LLMError("x"),
    ],
)
@pytest.mark.asyncio
async def test_datos_failure_keeps_documentos_and_warns(error):
    llm = FakeLLM([PLAN])
    result = await make(llm, datos=FakeDatos(error)).ask("pregunta de ejemplo", "auto", [])
    assert result.answer.startswith("Precisión") and result.sql is None and len(llm.calls) == 1
    assert len(result.warnings) == 1 and "datos" in result.warnings[0].lower()


@pytest.mark.asyncio
async def test_documentos_failure_keeps_datos_and_warns():
    llm = FakeLLM([PLAN])
    result = await make(llm, docs=FakeDocs(EmbeddingNotConfigured("x"))).ask("pregunta de ejemplo", "auto", [])
    assert result.answer == "Promedio 21,5 °C." and result.sources == []
    assert len(result.warnings) == 1 and "documentos" in result.warnings[0].lower()


@pytest.mark.asyncio
async def test_no_evidence_documentos_returns_datos_without_synthesis():
    llm = FakeLLM([PLAN])
    result = await make(llm, docs=FakeDocs(evidence=False)).ask("pregunta de ejemplo", "auto", [])
    assert result.answer == "Promedio 21,5 °C." and len(llm.calls) == 1 and result.sources == []


@pytest.mark.asyncio
async def test_datos_failure_and_no_evidence_returns_the_no_evidence_sentence():
    llm = FakeLLM([PLAN])
    result = await make(llm, datos=FakeDatos(Unanswerable()), docs=FakeDocs(evidence=False)).ask("pregunta", "auto", [])
    assert result.answer == NO_EVIDENCE and len(result.warnings) == 1 and len(llm.calls) == 1


@pytest.mark.asyncio
async def test_synthesis_failure_degrades_to_both_branch_answers():
    llm = FakeLLM([PLAN])
    calls = {"n": 0}
    original = llm.chat

    async def chat(messages, *, max_completion_tokens=None):
        calls["n"] += 1
        if calls["n"] == 2:
            raise LLMError("x")
        return await original(messages, max_completion_tokens=max_completion_tokens)

    llm.chat = chat
    result = await make(llm).ask("pregunta de ejemplo", "auto", [])
    assert "Promedio 21,5" in result.answer and "Precisión" in result.answer and result.warnings


@pytest.mark.parametrize(
    ("datos_error", "docs_error", "expected"),
    [
        (SQLRejected("no_select", "x"), None, SQLRejected),
        (QueryFailed("timeout"), None, QueryFailed),
        (LLMError("x"), None, LLMError),
        (SQLRejected("no_select", "x"), LLMError("x"), LLMError),
        (SQLRejected("no_select", "x"), SQLAlchemyError("x"), SQLAlchemyError),
    ],
)
@pytest.mark.asyncio
async def test_total_failure_raises_the_most_informative_error(datos_error, docs_error, expected):
    llm = FakeLLM([PLAN]) if docs_error else FakeLLM([])
    mode = "auto" if docs_error else "datos"
    service = make(llm, datos=FakeDatos(datos_error), docs=FakeDocs(docs_error))
    with pytest.raises(expected):
        await service.ask("pregunta de ejemplo", mode, [])


# ---- audit ---------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_chat_audit_row_is_written_once_with_kind_chat_and_never_breaks_the_answer():
    sink = Sink()
    await make(FakeLLM([PLAN, "ok"]), sink=sink).ask("pregunta de ejemplo", "auto", [])
    assert [r.kind for r in sink.records] == ["chat"] and sink.records[0].error_code is None

    class BrokenSink:
        async def record(self, record):
            raise RuntimeError("db down")

    result = await make(FakeLLM([PLAN, "ok"]), sink=BrokenSink()).ask("pregunta de ejemplo", "auto", [])
    assert result.answer == "ok"


@pytest.mark.asyncio
async def test_chat_audit_records_the_error_code_on_total_failure():
    sink = Sink()
    with pytest.raises(Unanswerable):
        await make(FakeLLM([]), datos=FakeDatos(Unanswerable()), sink=sink).ask("pregunta de ejemplo", "datos", [])
    assert sink.records[0].kind == "chat" and sink.records[0].error_code == "unanswerable"
