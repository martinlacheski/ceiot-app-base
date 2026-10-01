"""assistant_query_log (audit of generated SQL)

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-01

One row per assistant question, written by the service in its own transaction
(the query transaction is always rolled back). It stores what the model
generated and whether the guard accepted it, so abuse and prompt-injection
attempts are traceable. The user keeps the row if deleted (SET NULL).

Row Level Security (PostgreSQL only): append-only. SELECT/INSERT for the row's
own user and for the system identities (administrators run as ``system_admin``,
so they read everything). No UPDATE/DELETE policy exists, hence none is
possible. The read-only text-to-SQL role has no grant on this table at all.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0013"
down_revision: Union[str, Sequence[str], None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assistant_query_log",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("generated_sql", sa.Text(), nullable=True),
        sa.Column("validated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("error_code", sa.String(length=40), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_assistant_query_log_user_created", "assistant_query_log", ["user_id", "created_at"])

    if op.get_bind().dialect.name == "postgresql":
        uid = "current_setting('app.current_user_id', true)"
        system = f"{uid} = ANY (ARRAY['system_mqtt', 'system_admin'])"
        own = f"(user_id::text = {uid} AND {uid} <> '')"
        op.execute('ALTER TABLE public.assistant_query_log ENABLE ROW LEVEL SECURITY')
        op.execute('ALTER TABLE public.assistant_query_log FORCE ROW LEVEL SECURITY')
        op.execute(
            "CREATE POLICY assistant_log_read ON public.assistant_query_log FOR SELECT TO PUBLIC "
            f"USING ({system} OR {own})"
        )
        op.execute(
            "CREATE POLICY assistant_log_insert ON public.assistant_query_log FOR INSERT TO PUBLIC "
            f"WITH CHECK ({system} OR {own})"
        )


def downgrade() -> None:
    op.drop_table("assistant_query_log")
