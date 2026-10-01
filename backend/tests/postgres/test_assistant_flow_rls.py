"""End to end on PostgreSQL: fake LLM + real executor/schema/audit under a NOBYPASSRLS login."""

import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.assistant import sql_schema
from app.api.assistant.service import AssistantService, AuditRecord, DbAuditSink
from app.api.assistant.sql_executor import execute_validated_sql
from app.api.assistant.sql_guard import SQLRejected
from test_ai_read_views import world  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.asyncio


class FakeLLM:
    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    async def chat(self, messages, *, max_completion_tokens=None):
        self.calls.append(messages)
        return self.replies.pop(0)


@asynccontextmanager
async def _authed(engine, identity):
    """Same shape as get_authed_session."""
    async with engine.connect() as connection:
        async with AsyncSession(connection, expire_on_commit=False) as session:
            await session.execute(text("SELECT set_config('app.current_user_id', :uid, false)"), {"uid": identity})
            yield session


def _service(engine, session, identity, user_id, llm):
    async def run(validated):
        return await execute_validated_sql(engine, identity, validated)

    async def schema():
        return await sql_schema.schema_prompt(engine, identity)

    return AssistantService(llm=llm, run_sql=run, load_schema=schema, audit=DbAuditSink(session, user_id))


@pytest.fixture(autouse=True)
def _fresh_schema_cache():
    sql_schema.clear_cache()
    yield
    sql_schema.clear_cache()


async def _log_rows(postgres_rls_config, user_ids):
    admin = create_async_engine(postgres_rls_config.admin_url)
    try:
        async with admin.connect() as c:
            return (await c.execute(text(
                "SELECT user_id, question, generated_sql, validated, error_code, row_count FROM assistant_query_log "
                "WHERE user_id = ANY(:ids) ORDER BY created_at"), {"ids": list(user_ids)})).all()
    finally:
        await admin.dispose()


async def _cleanup(postgres_rls_config, user_ids):
    admin = create_async_engine(postgres_rls_config.admin_url)
    try:
        async with admin.begin() as c:
            await c.execute(text("DELETE FROM assistant_query_log WHERE user_id = ANY(:ids)"), {"ids": list(user_ids)})
    finally:
        await admin.dispose()


async def test_flow_answers_with_the_users_rows_only_and_writes_the_audit_row(
    postgres_rls_config, rls_engine_factory, world  # noqa: F811
):
    engine = rls_engine_factory(pool_size=2)
    owner_b = uuid.UUID(world.owner_b)
    try:
        llm = FakeLLM(
            "SELECT device_serial, COUNT(*) AS lecturas FROM ai_read.telemetry WHERE variable = 'temperature' "
            "AND sensor_key = 'dht22_1' GROUP BY device_serial LIMIT 10",
            "Hay 1 lectura.",
        )
        async with _authed(engine, world.owner_b) as session:
            answer = await _service(engine, session, world.owner_b, owner_b, llm).ask("¿Cuántas lecturas de temperatura hay?")
        assert [row["device_serial"] for row in answer.rows] == [world.device_b]  # tenant B only
        assert world.device_a not in str(llm.calls)  # nothing of tenant A reached the prompts either
        (logged,) = await _log_rows(postgres_rls_config, [owner_b])
        assert logged.validated is True and logged.error_code is None and logged.row_count == 1
        assert "ai_read.telemetry" in logged.generated_sql
    finally:
        await _cleanup(postgres_rls_config, [owner_b])


async def test_rejected_sql_is_audited_and_never_executed(postgres_rls_config, rls_engine_factory, world):  # noqa: F811
    engine = rls_engine_factory(pool_size=2)
    owner_a = uuid.UUID(world.owner_a)
    try:
        llm = FakeLLM("SELECT * FROM public.telemetry LIMIT 5", "SELECT password FROM public.\"user\" LIMIT 1")
        async with _authed(engine, world.owner_a) as session:
            with pytest.raises(SQLRejected):
                await _service(engine, session, world.owner_a, owner_a, llm).ask("dame todo")
        (logged,) = await _log_rows(postgres_rls_config, [owner_a])
        assert logged.validated is False and logged.error_code.startswith("sql_rejected:")
    finally:
        await _cleanup(postgres_rls_config, [owner_a])


async def test_audit_rows_follow_rls_users_see_their_own_admins_all_and_it_is_append_only(
    postgres_rls_config, rls_engine_factory, world  # noqa: F811
):
    engine = rls_engine_factory()
    a, b = uuid.UUID(world.owner_a), uuid.UUID(world.owner_b)
    record = AuditRecord(question="q", generated_sql="SELECT 1", validated=True, error_code=None, row_count=1, duration_ms=1)
    try:
        async with _authed(engine, world.owner_a) as session:
            await DbAuditSink(session, a).record(record)
            own = (await session.execute(text("SELECT count(*) FROM assistant_query_log"))).scalar_one()
            assert own >= 1
            with pytest.raises(DBAPIError):  # cannot write rows for somebody else
                await DbAuditSink(session, b).record(record)
            await session.rollback()
            updated = await session.execute(text("UPDATE assistant_query_log SET question = 'x'"))
            deleted = await session.execute(text("DELETE FROM assistant_query_log"))
            assert updated.rowcount == 0 and deleted.rowcount == 0  # no UPDATE/DELETE policy exists
            await session.rollback()
        async with _authed(engine, world.owner_b) as session:
            await DbAuditSink(session, b).record(record)
            rows = (await session.execute(text("SELECT user_id FROM assistant_query_log"))).scalars().all()
            assert set(rows) == {b}  # never owner A's rows
        async with _authed(engine, "system_admin") as session:
            rows = (await session.execute(text("SELECT user_id FROM assistant_query_log"))).scalars().all()
            assert {a, b} <= set(rows)
        async with _authed(engine, "nobody") as session:
            assert (await session.execute(text("SELECT count(*) FROM assistant_query_log"))).scalar_one() == 0
    finally:
        await _cleanup(postgres_rls_config, [a, b])
