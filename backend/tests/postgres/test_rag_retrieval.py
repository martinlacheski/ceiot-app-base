"""RAG storage and retrieval on real PostgreSQL with pgvector.

Retrieval runs for every authenticated user through the SECURITY DEFINER
function ``rag_search``; the chunk table itself stays admin-only.
"""

import math
import uuid
from contextlib import asynccontextmanager

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.api.document.chunks import replace_chunks, search_chunks
from app.api.document.parsing import Chunk
from app.core.embeddings import EMBEDDING_DIMENSIONS

pytestmark = pytest.mark.asyncio

MODEL = "baai/bge-m3"


def vec(distance: float, axis: int = 1) -> list[float]:
    """Unit vector whose cosine distance to ``vec(0.0)`` (= e0) is ``distance``."""
    cosine = 1.0 - distance
    out = [0.0] * EMBEDDING_DIMENSIONS
    out[0] = cosine
    out[axis] = math.sqrt(max(0.0, 1.0 - cosine * cosine))
    return out


QUERY = vec(0.0)


@asynccontextmanager
async def _as(engine, identity):
    async with engine.connect() as connection:
        async with AsyncSession(connection, expire_on_commit=False) as session:
            await session.execute(text("SELECT set_config('app.current_user_id', :uid, false)"), {"uid": identity})
            yield session


@pytest_asyncio.fixture
async def world(postgres_rls_config):
    admin_engine = create_async_engine(postgres_rls_config.admin_url)
    suffix = uuid.uuid4().hex[:8]
    ordinary = User(email=f"rag-user-{suffix}@example.com", username=f"rag-user-{suffix}", password="x")
    administrator = User(email=f"rag-admin-{suffix}@example.com", username=f"rag-admin-{suffix}",
                         password="x", is_admin=True)
    doc_ids: list[uuid.UUID] = []

    async def make_document(title, *, status="ready", active=True, provider="openrouter", chunks):
        doc_id = uuid.uuid4()
        doc_ids.append(doc_id)
        async with AsyncSession(admin_engine, expire_on_commit=False) as session:
            await session.execute(
                text(
                    "INSERT INTO document (id, title, filename, content_type, size_bytes, sha256, storage_key, "
                    "is_active, ingestion_status, embedding_provider, embedding_model, chunk_count) "
                    "VALUES (:id, :t, 'f.txt', 'text/plain', 1, :sha, 'k', :active, :st, :p, :m, :n)"
                ),
                {"id": doc_id, "t": title, "sha": uuid.uuid4().hex + uuid.uuid4().hex, "active": active,
                 "st": status, "p": provider, "m": MODEL, "n": len(chunks)},
            )
            await replace_chunks(
                session, doc_id,
                [Chunk(i, page, section, content) for i, (content, page, section, _d) in enumerate(chunks)],
                [vec(d, axis=i + 1) for i, (_c, _p, _s, d) in enumerate(chunks)],
                provider=provider, model=MODEL,
            )
            await session.commit()
        return doc_id

    async with AsyncSession(admin_engine, expire_on_commit=False) as session:
        session.add_all([ordinary, administrator])
        await session.commit()
    try:
        yield {"engine": admin_engine, "ordinary": ordinary, "admin": administrator, "make": make_document}
    finally:
        async with admin_engine.begin() as cleanup:
            for doc_id in doc_ids:
                await cleanup.execute(text("DELETE FROM document WHERE id = :id"), {"id": doc_id})
            await cleanup.execute(text('DELETE FROM "user" WHERE id IN (:a, :b)'),
                                  {"a": ordinary.id, "b": administrator.id})
        await admin_engine.dispose()


async def _search(role_engine, identity, **kwargs):
    params = {"provider": "openrouter", "model": MODEL, "max_distance": 0.55, "top_k": 4, **kwargs}
    async with _as(role_engine, identity) as session:
        return await search_chunks(session, QUERY, **params)


async def test_cosine_order_and_cutoff(world, rls_engine_factory):
    doc = await world["make"]("Manual", chunks=[("lejos", 3, None, 0.5), ("cerca", 1, "Alarmas", 0.1),
                                                ("medio", 2, None, 0.3), ("fuera", 9, None, 0.6)])
    results = await _search(rls_engine_factory(), str(world["ordinary"].id), document_id=doc)
    assert [r.content for r in results] == ["cerca", "medio", "lejos"]
    assert [round(r.distance, 3) for r in results] == [0.1, 0.3, 0.5]
    first = results[0]
    assert (first.document_id, first.title, first.page, first.section) == (doc, "Manual", 1, "Alarmas")


async def test_cutoff_is_applied_before_top_k(world, rls_engine_factory):
    doc = await world["make"]("Manual", chunks=[("a", 1, None, 0.1), ("b", 1, None, 0.2), ("c", 1, None, 0.7)])
    results = await _search(rls_engine_factory(), str(world["ordinary"].id), top_k=3, document_id=doc)
    assert [r.content for r in results] == ["a", "b"]


async def test_top_k_is_capped_in_the_database(world, rls_engine_factory):
    doc = await world["make"]("Manual", chunks=[(f"c{i}", 1, None, 0.01 * (i + 1)) for i in range(10)])
    results = await _search(rls_engine_factory(), str(world["ordinary"].id), top_k=50, document_id=doc)
    assert len(results) == 8


async def test_provider_and_model_filter_never_mixes_vectors(world, rls_engine_factory):
    local = await world["make"]("Local", provider="local", chunks=[("local-chunk", 1, None, 0.05)])
    remote = await world["make"]("Remote", provider="openrouter", chunks=[("remote-chunk", 1, None, 0.2)])
    engine, user = rls_engine_factory(), str(world["ordinary"].id)
    contents = {r.content for r in await _search(engine, user)} & {"local-chunk", "remote-chunk"}
    assert contents == {"remote-chunk"}
    local_hits = await _search(engine, user, provider="local", document_id=local)
    assert [r.content for r in local_hits] == ["local-chunk"]
    assert await _search(engine, user, model="other/model", document_id=remote) == []


async def test_inactive_and_unready_documents_are_never_returned(world, rls_engine_factory):
    ids = {
        "inactive": await world["make"]("Inactivo", active=False, chunks=[("x", 1, None, 0.1)]),
        "processing": await world["make"]("Procesando", status="processing", chunks=[("x", 1, None, 0.1)]),
        "failed": await world["make"]("Fallido", status="failed", chunks=[("x", 1, None, 0.1)]),
        "pending": await world["make"]("Pendiente", status="pending", chunks=[("x", 1, None, 0.1)]),
        "ready": await world["make"]("Listo", chunks=[("x", 1, None, 0.1)]),
    }
    engine, user = rls_engine_factory(), str(world["ordinary"].id)
    for name, doc_id in ids.items():
        found = await _search(engine, user, document_id=doc_id)
        assert bool(found) == (name == "ready"), name


async def test_any_authenticated_identity_can_search_but_not_read_the_chunk_table(world, rls_engine_factory):
    doc = await world["make"]("Manual", chunks=[("secreto", 1, None, 0.1)])
    engine = rls_engine_factory()
    for identity in (str(world["ordinary"].id), str(world["admin"].id)):
        assert [r.content for r in await _search(engine, identity, document_id=doc)] == ["secreto"]
    async with _as(engine, str(world["ordinary"].id)) as session:
        assert (await session.execute(text("SELECT count(*) FROM document_chunk"))).scalar_one() == 0
        with pytest.raises(DBAPIError):
            await session.execute(
                text("INSERT INTO document_chunk (id, document_id, chunk_index, content, content_sha256, embedding,"
                     " embedding_provider, embedding_model) VALUES (gen_random_uuid(), :d, 99, 'x', :h,"
                     " CAST(:v AS vector), 'local', 'm')"),
                {"d": doc, "h": "0" * 64, "v": "[" + ",".join(["0.1"] * EMBEDDING_DIMENSIONS) + "]"},
            )
        await session.rollback()
    async with _as(engine, "system_admin") as session:
        assert (await session.execute(text("SELECT count(*) FROM document_chunk WHERE document_id = :d"),
                                      {"d": doc})).scalar_one() == 1


async def test_text_to_sql_role_cannot_run_the_search_function(world):
    async with world["engine"].connect() as connection:
        await connection.execute(text("SET ROLE ai_readonly"))
        with pytest.raises(DBAPIError):
            await connection.execute(
                text("SELECT * FROM public.rag_search(CAST(:q AS vector), 'openrouter', :m, 0.55, 4, NULL)"),
                {"q": "[" + ",".join(["0.1"] * EMBEDDING_DIMENSIONS) + "]", "m": MODEL},
            )
        await connection.rollback()


async def test_replace_chunks_swaps_the_whole_set_and_deleting_the_document_cascades(world):
    doc = await world["make"]("Manual", chunks=[("viejo uno", 1, None, 0.1), ("viejo dos", 1, None, 0.2)])
    async with AsyncSession(world["engine"], expire_on_commit=False) as session:
        await replace_chunks(session, doc, [Chunk(0, None, "S", "nuevo")], [vec(0.1)], provider="openrouter", model=MODEL)
        await session.commit()
        rows = (await session.execute(text("SELECT content, section, embedding_provider FROM document_chunk "
                                           "WHERE document_id = :d"), {"d": doc})).all()
        assert [tuple(r) for r in rows] == [("nuevo", "S", "openrouter")]
        await session.execute(text("DELETE FROM document WHERE id = :d"), {"d": doc})
        await session.commit()
        assert (await session.execute(text("SELECT count(*) FROM document_chunk WHERE document_id = :d"),
                                      {"d": doc})).scalar_one() == 0


async def test_wrong_dimension_vectors_are_rejected_by_the_database(world):
    doc = await world["make"]("Manual", chunks=[("ok", 1, None, 0.1)])
    async with AsyncSession(world["engine"], expire_on_commit=False) as session:
        with pytest.raises(Exception):
            await replace_chunks(session, doc, [Chunk(0, None, None, "corto")], [[0.1, 0.2, 0.3]],
                                 provider="openrouter", model=MODEL)
        await session.rollback()
