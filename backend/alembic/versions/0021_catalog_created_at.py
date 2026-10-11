"""created_at on device, environment, location and type catalogs

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-11

Normalization item 9: these tables only had ``updated_at``. Each gains
``created_at timestamptz NOT NULL DEFAULT now()``; PostgreSQL fills existing rows with the
migration time (their real creation time is unknown). It is ``timestamptz`` from the start,
like the newer tables (``document``, ``sensor``, ``device_sensor``), so it does not add to
the naive ``timestamp`` columns item 8 still has to convert.

``device_type`` already has ``created_at`` (0001, still naive: item 8); the sensor catalog
tables already have it as ``timestamptz``. ``now()`` is a non-volatile default, so
PostgreSQL stores it once in the catalog instead of rewriting the tables (small anyway).

Downgrade drops the columns.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0021"
down_revision: Union[str, Sequence[str], None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = (
    "device",
    "environment",
    "environmenttype",
    "locationcountry",
    "locationstate",
    "locationcity",
    "identificationtype",
)


def upgrade() -> None:
    for table in TABLES:
        op.add_column(
            table,
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_column(table, "created_at")
