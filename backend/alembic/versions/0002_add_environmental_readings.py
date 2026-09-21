"""add environmental readings

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add nullable environmental measurement columns."""
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


def downgrade() -> None:
    """Remove environmental measurement columns."""
    op.drop_column("sensorreading", "pressure_hpa")
    op.drop_column("sensorreading", "relative_humidity_pct")
    op.drop_column("sensorreading", "temperature_c")
