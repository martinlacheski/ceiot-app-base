"""drop sensorreading.device_type

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-11

Normalization item 5: ``sensorreading.device_type`` was a free-text copy of the device's
type, but the type is ``device.device_type_id`` (``device_type`` catalog). Nothing reads
the column: the history, exports, the assistant views (``ai_read.devices`` joins
``device_type`` through ``device``) and the frontend never select it, and the firmware
never sends the key, so every row holds the handler's ``'generic'`` fallback (verified on
the dev database: 4032 of 4032 rows). A reading's type is reachable through ``device_id``;
the former-owner history keeps relying on the ``device_serial`` / ``environment_id``
snapshot, which stays.

``sensorreading`` is a TimescaleDB hypertable without compression (see 0008), so a plain
DROP COLUMN works; it is a catalog-only change in PostgreSQL (no table rewrite).

Downgrade re-adds the column ``NOT NULL`` as 0001 created it, filling existing rows with
``'generic'`` (the only value it ever held) and then dropping that temporary default.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0020"
down_revision: Union[str, Sequence[str], None] = "0019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("sensorreading", "device_type")


def downgrade() -> None:
    op.add_column(
        "sensorreading",
        sa.Column("device_type", sa.String(), nullable=False, server_default="generic"),
    )
    op.alter_column("sensorreading", "device_type", server_default=None)
