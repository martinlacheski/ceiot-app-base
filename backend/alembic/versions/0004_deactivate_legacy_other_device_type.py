"""deactivate_legacy_other_device_type

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-23 00:00:00.000000

The "Other" device type (`other`, fixed id `f2b0f5a8-0a91-4d2a-a3f3-04f6be5d2d13`) was never a real
product: it was a legacy catch-all shown in the device type selector. Deactivate it instead of
deleting it, since a device in production may still reference it via FK; deactivation is reversible
and existing devices of this type keep resolving normally (only the selector and new assignments
exclude inactive rows).

Purely a data update: flips `is_active` to false. Idempotent — a no-op when the row does not exist.

Downgrade reactivates the row (a no-op when it does not exist).
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Fixed value copied here on purpose: a migration must not change if the constant changes.
LEGACY_OTHER_DEVICE_TYPE_ID = uuid.UUID("f2b0f5a8-0a91-4d2a-a3f3-04f6be5d2d13")

device_type = sa.table(
    "device_type",
    sa.column("id", sa.Uuid()),
    sa.column("is_active", sa.Boolean()),
)


def upgrade() -> None:
    op.get_bind().execute(
        device_type.update()
        .where(device_type.c.id == LEGACY_OTHER_DEVICE_TYPE_ID)
        .values(is_active=False)
    )


def downgrade() -> None:
    op.get_bind().execute(
        device_type.update()
        .where(device_type.c.id == LEGACY_OTHER_DEVICE_TYPE_ID)
        .values(is_active=True)
    )
