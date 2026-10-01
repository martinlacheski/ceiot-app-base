"""`document` is admin-only content: a NOBYPASSRLS role sees it only as admin/system."""

import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User

pytestmark = pytest.mark.asyncio

INSERT = text(
    "INSERT INTO document (id, title, filename, content_type, size_bytes, sha256, storage_key) "
    "VALUES (:id, 't', 'f.txt', 'text/plain', 1, :sha, 'k')"
)


@asynccontextmanager
async def _as(engine, identity):
    """Same shape as get_authed_session: one explicit connection keeps the identity across commits."""
    async with engine.connect() as connection:
        async with AsyncSession(connection, expire_on_commit=False) as session:
            await session.execute(text("SELECT set_config('app.current_user_id', :uid, false)"), {"uid": identity})
            yield session


async def test_only_system_and_admin_identities_reach_documents(postgres_rls_config, rls_engine_factory):
    admin_engine = create_async_engine(postgres_rls_config.admin_url)
    suffix = uuid.uuid4().hex[:8]
    administrator = User(email=f"doc-admin-{suffix}@example.com", username=f"doc-admin-{suffix}",
                         password="x", is_admin=True)
    ordinary = User(email=f"doc-user-{suffix}@example.com", username=f"doc-user-{suffix}", password="x")
    doc_id = uuid.uuid4()
    try:
        async with AsyncSession(admin_engine, expire_on_commit=False) as setup:
            setup.add_all([administrator, ordinary])
            await setup.commit()

        role_engine = rls_engine_factory()
        count = text("SELECT count(*) FROM document WHERE id = :id")
        async with _as(role_engine, str(administrator.id)) as session:
            await session.execute(INSERT, {"id": doc_id, "sha": suffix.ljust(64, "0")})
            await session.commit()
            assert (await session.execute(count, {"id": doc_id})).scalar_one() == 1

        for identity in (str(ordinary.id), "", "nobody"):
            async with _as(role_engine, identity) as session:
                assert (await session.execute(count, {"id": doc_id})).scalar_one() == 0, identity
                with pytest.raises(DBAPIError):
                    await session.execute(INSERT, {"id": uuid.uuid4(), "sha": uuid.uuid4().hex.ljust(64, "1")})
                await session.rollback()

        async with _as(role_engine, "system_mqtt") as session:
            assert (await session.execute(count, {"id": doc_id})).scalar_one() == 1
    finally:
        async with admin_engine.begin() as cleanup:
            await cleanup.execute(text("DELETE FROM document WHERE id = :id"), {"id": doc_id})
            await cleanup.execute(text('DELETE FROM "user" WHERE id IN (:a, :b)'),
                                  {"a": administrator.id, "b": ordinary.id})
        await admin_engine.dispose()
