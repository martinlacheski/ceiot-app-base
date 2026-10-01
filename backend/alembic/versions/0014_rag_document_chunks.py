"""RAG: pgvector, document ingestion fields, document_chunk and rag_search

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-01

Vectors live in PostgreSQL (pgvector, ``vector(1024)`` for BAAI/bge-m3); no
separate vector database. ``document`` gains ``chunk_count`` and the
``embedding_provider`` / ``embedding_model`` that produced its current chunks
(``ingestion_status``, ``ingested_at`` and ``error`` already exist from 0011).
Every chunk repeats provider and model so vectors of different providers are
never mixed: retrieval filters by the *current* provider and model, and a
provider switch is an explicit re-index (nothing is silently re-embedded).

``document_chunk`` follows ``document``: Row Level Security, admin and system
identities only (FORCE, so the owner role is bound too). Nobody else reads
chunks directly, and the read-only text-to-SQL role has no grant on it.

Retrieval for the chat is a different question from managing documents: every
authenticated user may ASK, but ordinary users must not see ``document`` rows or
inactive content. The only door is ``public.rag_search`` (SECURITY DEFINER, fixed
search_path, runs with the ``system_admin`` identity for its own duration via the
function-level SET): it returns chunks of *active, ready* documents whose
provider/model match, within the cosine cutoff, capped at 8. EXECUTE is revoked
from PUBLIC (so ``ai_readonly`` cannot call it); the application login owns the
function. Retrieval is therefore bounded by the function body, not by a caller
supplied identity.

The HNSW index (``vector_cosine_ops``) serves the nearest-neighbour ordering; the
function keeps the provider/model/activity filters as plain predicates, which is
exact for a corpus of administrator documents (thousands of chunks). Revisit with
iterative index scans if the corpus grows by orders of magnitude.

``assistant_query_log.kind`` distinguishes text-to-SQL (``sql``) from RAG
(``rag``) audit rows. CREATE EXTENSION needs a role allowed to install pgvector
(superuser in the dev image). PostgreSQL only for the vector parts; other
dialects (the SQLite unit tests) get only the plain columns.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0014"
down_revision: Union[str, Sequence[str], None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PROVIDERS = "('openrouter', 'local')"
MAX_TOP_K = 8


def upgrade() -> None:
    op.add_column("document", sa.Column("chunk_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("document", sa.Column("embedding_provider", sa.String(length=16), nullable=True))
    op.add_column("document", sa.Column("embedding_model", sa.Text(), nullable=True))
    op.add_column("assistant_query_log", sa.Column("kind", sa.String(length=16), nullable=False, server_default="sql"))

    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute(
        f"""
        CREATE TABLE public.document_chunk (
            id uuid PRIMARY KEY,
            document_id uuid NOT NULL REFERENCES public.document (id) ON DELETE CASCADE,
            chunk_index integer NOT NULL CHECK (chunk_index >= 0),
            page integer CHECK (page IS NULL OR page > 0),
            section text,
            content text NOT NULL CHECK (btrim(content) <> ''),
            content_sha256 varchar(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{{64}}$'),
            embedding vector(1024) NOT NULL,
            embedding_provider varchar(16) NOT NULL CHECK (embedding_provider IN {PROVIDERS}),
            embedding_model text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_document_chunk_position UNIQUE (document_id, chunk_index),
            CONSTRAINT ck_document_chunk_embedding_dims CHECK (vector_dims(embedding) = 1024)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_document_chunk_embedding ON public.document_chunk "
        "USING hnsw (embedding vector_cosine_ops)"
    )
    op.execute("CREATE INDEX ix_document_chunk_identity ON public.document_chunk (embedding_provider, embedding_model)")

    uid = "current_setting('app.current_user_id', true)"
    system = f"{uid} = ANY (ARRAY['system_mqtt', 'system_admin'])"
    admin = (
        "EXISTS (SELECT 1 FROM public.\"user\" u "
        f"WHERE u.id::text = {uid} AND u.is_admin AND u.is_active)"
    )
    op.execute("ALTER TABLE public.document_chunk ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.document_chunk FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY document_chunk_admin_only ON public.document_chunk FOR ALL TO PUBLIC "
        f"USING ({system} OR {admin}) WITH CHECK ({system} OR {admin})"
    )

    op.execute(
        f"""
        CREATE FUNCTION public.rag_search(
            p_embedding public.vector,
            p_provider text,
            p_model text,
            p_max_distance double precision,
            p_top_k integer,
            p_document_id uuid DEFAULT NULL
        )
        RETURNS TABLE (
            document_id uuid, title text, chunk_index integer, page integer,
            section text, content text, distance double precision
        )
        LANGUAGE sql STABLE SECURITY DEFINER
        SET search_path = pg_catalog, public
        SET app.current_user_id = 'system_admin'
        AS $$
            SELECT c.document_id, d.title, c.chunk_index, c.page, c.section, c.content, c.distance
            FROM (
                SELECT ch.document_id, ch.chunk_index, ch.page, ch.section, ch.content,
                       (ch.embedding <=> p_embedding)::double precision AS distance
                FROM public.document_chunk ch
                WHERE ch.embedding_provider = p_provider
                  AND lower(ch.embedding_model) = lower(p_model)
                  AND (p_document_id IS NULL OR ch.document_id = p_document_id)
            ) c
            JOIN public.document d ON d.id = c.document_id
            WHERE d.is_active
              AND d.ingestion_status = 'ready'
              AND d.embedding_provider = p_provider
              AND lower(d.embedding_model) = lower(p_model)
              AND c.distance <= p_max_distance
            ORDER BY c.distance, c.document_id, c.chunk_index
            LIMIT LEAST(GREATEST(p_top_k, 1), {MAX_TOP_K})
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION public.rag_search(public.vector, text, text, double precision, integer, uuid) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.rag_search(public.vector, text, text, double precision, integer, uuid) "
        "TO CURRENT_USER"
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "DROP FUNCTION IF EXISTS public.rag_search(public.vector, text, text, double precision, integer, uuid)"
        )
        op.execute("DROP TABLE IF EXISTS public.document_chunk")
        # The vector extension is left installed: dropping it is a cluster-level decision.
    op.drop_column("assistant_query_log", "kind")
    op.drop_column("document", "embedding_model")
    op.drop_column("document", "embedding_provider")
    op.drop_column("document", "chunk_count")
