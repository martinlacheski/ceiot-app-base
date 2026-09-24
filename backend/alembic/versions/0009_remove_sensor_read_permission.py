"""remove sensor_read permission

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-24

The `sensor:read` permission code (`app.api.sensor.permissions.SensorPermissions.READ`)
only ever gated the C10 `/api/devices/{id}/sensor-readings/latest|history` endpoints.
Those endpoints were removed in S6 (migration 0008 dropped the columns they served),
and nothing else in the backend or frontend checks this code anymore -- it was left
dangling on `ALL_PERMISSIONS`/`BASIC_PERMISSIONS` and on every user's stored
`permissions` JSON array.

Purely a data update on `"user".permissions`, following the same style as 0006
(the migration that originally granted the S3 codes): idempotent in both
directions.

upgrade(): removes `sensor:read` from every user that currently holds it.

downgrade(): re-adds `sensor:read` to every user holding `device:read`, mirroring
how 0006 derived its own grants from the same signal (device:read implies "can see
this device's data"). This is a **best-effort reconstruction**, not a byte-for-byte
restoration: 0006's forward direction shows `sensor:read` was already present on
every account created before that migration ran (it was in `BASIC_PERMISSIONS` from
the start), and it may also have been granted individually to accounts that don't
hold `device:read` (e.g. an admin without device:read, or a custom grant) -- those
accounts will NOT get it back on downgrade. If an exact restoration is ever needed,
it must come from a backup taken before running upgrade().
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Fixed value copied here on purpose: a migration must not change if the
# permission constants in app.core.permissions change (the module that
# defined it, app.api.sensor.permissions, is deleted by this same change).
SENSOR_READ = "sensor:read"
DEVICE_READ = "device:read"

user_table = sa.table(
    "user",
    sa.column("id", sa.Uuid()),
    sa.column("permissions", sa.JSON()),
)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.select(user_table.c.id, user_table.c.permissions)).all()
    for user_id, permissions in rows:
        current = set(permissions or [])
        if SENSOR_READ in current:
            bind.execute(
                user_table.update()
                .where(user_table.c.id == user_id)
                .values(permissions=sorted(current - {SENSOR_READ}))
            )


def downgrade() -> None:
    """Best-effort reconstruction: see module docstring."""
    bind = op.get_bind()
    rows = bind.execute(sa.select(user_table.c.id, user_table.c.permissions)).all()
    for user_id, permissions in rows:
        current = set(permissions or [])
        if DEVICE_READ in current and SENSOR_READ not in current:
            bind.execute(
                user_table.update()
                .where(user_table.c.id == user_id)
                .values(permissions=sorted(current | {SENSOR_READ}))
            )
