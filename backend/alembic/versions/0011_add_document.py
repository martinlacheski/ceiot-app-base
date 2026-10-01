"""add document (admin documents corpus)

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-01

Metadata for files stored in object storage (SeaweedFS S3); the bytes live
under `storage_key`, never in PostgreSQL. This is the corpus the RAG
ingestion (R4) will chunk and embed, hence the `ingestion_status`,
`ingested_at` and `error` columns, which stay `pending` / NULL until then.

`sha256` is unique: the same bytes are stored once (the API answers 409).
`uploaded_by` keeps the row if the uploader is deleted (ON DELETE SET NULL).

Row Level Security: documents are global administrator content, not tenant
data. The API is admin-only, and the policy below repeats that boundary in the
database (same identity convention as the sensor catalog): only the system
identities and active administrators may read or write. Ordinary users and any
future read-only text-to-SQL role (which carries no identity) see no rows, so
`document` must NOT be added to the curated text-to-SQL views.
RLS is PostgreSQL-only; other dialects (the SQLite unit tests) skip it.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INGESTION_STATUSES = ("pending", "processing", "ready", "failed")


def upgrade() -> None:
    op.create_table(
        "document",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("uploaded_by", sa.Uuid(), sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("ingestion_status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "ingestion_status IN ('pending', 'processing', 'ready', 'failed')",
            name="ck_document_ingestion_status",
        ),
        sa.CheckConstraint("size_bytes >= 0", name="ck_document_size_bytes"),
    )
    op.create_index("ix_document_sha256", "document", ["sha256"], unique=True)
    op.create_index("ix_document_created_at", "document", ["created_at"])
    op.create_index("ix_document_uploaded_by", "document", ["uploaded_by"])

    if op.get_bind().dialect.name == "postgresql":
        uid = "current_setting('app.current_user_id', true)"
        system = f"{uid} = ANY (ARRAY['system_mqtt', 'system_admin'])"
        admin = (
            "EXISTS (SELECT 1 FROM public.\"user\" u "
            f"WHERE u.id::text = {uid} AND u.is_admin AND u.is_active)"
        )
        op.execute('ALTER TABLE public."document" ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE public."document" FORCE ROW LEVEL SECURITY')
        op.execute(
            "CREATE POLICY document_admin_only ON public.document FOR ALL TO PUBLIC "
            f"USING ({system} OR {admin}) WITH CHECK ({system} OR {admin})"
        )


def downgrade() -> None:
    # Dropping the table also drops its policy and indexes.
    op.drop_table("document")
