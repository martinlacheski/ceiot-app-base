"""device operations snapshot the device name when a device leaves an establishment

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-11

Unpairing a device (or moving it to another establishment) is now recorded as a
``deviceoperation`` row in the establishment being left, carrying the name the device had
there. The former owner can no longer read the live ``device`` row (RLS follows the current
owner), and a later owner's rename must never reach them, so the device-history list reads
this snapshot instead.

upgrade(): adds the nullable ``deviceoperation.device_name`` column and the ``UNPAIR`` and
``MOVE`` values of ``deviceoperationtype`` (the enum stores member names). Existing rows keep
a NULL name: there is no trustworthy source for the name a device had in a past
establishment, so only unpairs/moves from now on carry one.

downgrade(): drops the column. Enum values cannot be dropped in PostgreSQL; they stay
(``ADD VALUE IF NOT EXISTS`` keeps a re-upgrade idempotent), like 0019's ``FIRMWARE_UPDATE``.
Rows of those types would be unreadable by the pre-0027 application, so they are deleted
first.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | Sequence[str] | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("deviceoperation", sa.Column("device_name", sa.String(), nullable=True))
    # Allowed inside the migration transaction (PostgreSQL >= 12); the values are only used
    # by the application afterwards.
    op.execute("ALTER TYPE deviceoperationtype ADD VALUE IF NOT EXISTS 'UNPAIR'")
    op.execute("ALTER TYPE deviceoperationtype ADD VALUE IF NOT EXISTS 'MOVE'")


def downgrade() -> None:
    # deviceoperation FORCEs RLS and has no DELETE policy: lift RLS for this transactional
    # statement only (same approach as 0003).
    op.execute("ALTER TABLE public.deviceoperation DISABLE ROW LEVEL SECURITY")
    op.execute("DELETE FROM public.deviceoperation WHERE operation_type::text IN ('UNPAIR', 'MOVE')")
    op.execute("ALTER TABLE public.deviceoperation ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.deviceoperation FORCE ROW LEVEL SECURITY")
    op.drop_column("deviceoperation", "device_name")
