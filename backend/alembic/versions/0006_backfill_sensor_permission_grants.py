"""backfill_sensor_permission_grants

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-23 00:00:00.000000

S3 introduced four new permission codes (sensor_catalog:read, device_sensor:read,
device_sensor:write, telemetry:read) and added them to ``ALL_PERMISSIONS`` and
``BASIC_PERMISSIONS``. Those constants only affect *new* users: admins get a
snapshot of ``ALL_PERMISSIONS`` and everyone else a snapshot of
``BASIC_PERMISSIONS`` at creation time (see ``app.core.init_data.create_default_admin``
and ``AuthService``), so every account created before this migration is missing
the new codes and would get 403s from the new S3 endpoints.

Backfill, following the same grant intent as the S3 permission model:
  - Admins (``is_admin``) get all four new codes.
  - Everyone else who already holds ``device:read`` gets the three read-side
    codes (``sensor_catalog:read``, ``device_sensor:read``, ``telemetry:read``):
    they can already see the device, so they can already see its sensors/telemetry.
  - Everyone who already holds ``device:update`` or ``device:create`` also gets
    ``device_sensor:write``: they can already change the device, so they can
    already manage which sensors are attached to it.

Purely a data update on ``"user".permissions`` (a JSON array). Idempotent in
both directions: re-running upgrade only adds codes that are still missing;
re-running downgrade only removes codes that are still present. Downgrade
removes exactly the four new codes from every user (a clean, unconditional
reversal — it does not try to reconstruct which rule originally granted them).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Fixed values copied here on purpose: a migration must not change if the
# permission constants in app.core.permissions / app.api.device.permissions change.
SENSOR_CATALOG_READ = "sensor_catalog:read"
DEVICE_SENSOR_READ = "device_sensor:read"
DEVICE_SENSOR_WRITE = "device_sensor:write"
TELEMETRY_READ = "telemetry:read"
NEW_CODES = {SENSOR_CATALOG_READ, DEVICE_SENSOR_READ, DEVICE_SENSOR_WRITE, TELEMETRY_READ}

DEVICE_READ = "device:read"
DEVICE_UPDATE = "device:update"
DEVICE_CREATE = "device:create"

user_table = sa.table(
    "user",
    sa.column("id", sa.Uuid()),
    sa.column("is_admin", sa.Boolean()),
    sa.column("permissions", sa.JSON()),
)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(user_table.c.id, user_table.c.is_admin, user_table.c.permissions)
    ).all()
    for user_id, is_admin, permissions in rows:
        current = set(permissions or [])
        additions: set[str] = set()
        if is_admin:
            additions |= NEW_CODES
        else:
            if DEVICE_READ in current:
                additions |= {SENSOR_CATALOG_READ, DEVICE_SENSOR_READ, TELEMETRY_READ}
            if DEVICE_UPDATE in current or DEVICE_CREATE in current:
                additions.add(DEVICE_SENSOR_WRITE)

        missing = additions - current
        if missing:
            bind.execute(
                user_table.update()
                .where(user_table.c.id == user_id)
                .values(permissions=sorted(current | missing))
            )


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.select(user_table.c.id, user_table.c.permissions)).all()
    for user_id, permissions in rows:
        current = set(permissions or [])
        if current & NEW_CODES:
            bind.execute(
                user_table.update()
                .where(user_table.c.id == user_id)
                .values(permissions=sorted(current - NEW_CODES))
            )
