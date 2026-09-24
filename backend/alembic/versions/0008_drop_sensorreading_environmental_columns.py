"""drop sensorreading environmental columns

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-24

S6 cleanup: environmental values (temperature/humidity/pressure) now live
exclusively in the JSONB `telemetry` table (see 0005), keyed by installed
device sensor and validated per S2/S3. `sensorreading` goes back to what its
name says: device health only (uptime, firmware, wifi, heap, reset reason,
errors) plus the free-form `extra_data` JSONB for anything not modeled yet.

`sensorreading` is a TimescaleDB hypertable, but compression is not enabled
on it (no compression policy, no continuous aggregate reads these columns),
so a plain ALTER TABLE ... DROP COLUMN works directly -- no decompression or
policy juggling needed. Verified on the dev database before writing this
migration: temperature_c/relative_humidity_pct/pressure_hpa are NULL on all
existing rows (nothing meaningful to lose).

Downgrade re-adds the three columns nullable (mirrors 0002, which first
added them), so a device published against a downgraded schema would leave
them NULL again -- exactly the "add nullable environmental measurement
columns" migration 0002 already was for.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Drop the legacy fixed-column environmental measurements."""
    op.drop_column("sensorreading", "pressure_hpa")
    op.drop_column("sensorreading", "relative_humidity_pct")
    op.drop_column("sensorreading", "temperature_c")


def downgrade() -> None:
    """Re-add the environmental measurement columns, nullable."""
    op.add_column(
        "sensorreading",
        sa.Column("temperature_c", sa.Float(), nullable=True),
    )
    op.add_column(
        "sensorreading",
        sa.Column("relative_humidity_pct", sa.Float(), nullable=True),
    )
    op.add_column(
        "sensorreading",
        sa.Column("pressure_hpa", sa.Float(), nullable=True),
    )
