"""device.model becomes an optional override of the type's hardware model

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-11

Normalization item 6: 0018 backfilled ``device_type.hardware_model`` from the most common
``device.model`` of each type but kept every device's copy, and device creation kept copying
the type default into new devices. The model is now a per-unit override: NULL means "use the
type's hardware model", and the API exposes the effective value
``COALESCE(device.model, device_type.hardware_model)``.

upgrade(): ``device.model`` is set to NULL where it equals the device type's
``hardware_model`` (trimmed, case-insensitive), so those devices follow the type from now on.
Blank models (empty or whitespace only) are nulled too: they never carried a value. A model
that differs from the type (or whose type has no hardware model) is kept as the override.

downgrade() materializes the defaults: every device whose ``model`` is NULL gets its type's
``hardware_model`` (the effective value it was showing), so the pre-0024 application, which
reads ``device.model`` directly, keeps displaying the same model. Devices that had a NULL or
blank model before the upgrade also receive the type default; the original spelling of a
nulled value (case, surrounding spaces) is normalized to the type's.

Both statements run as ``system_admin`` (transaction-local ``app.current_user_id``) because
``device`` FORCEs row level security and a non-superuser migration role would otherwise update
nothing; the previous value is restored afterwards. ``device.updated_at`` is not touched (it
is maintained by the ORM, not a trigger).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: str | Sequence[str] | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UID = "current_setting('app.current_user_id', true)"


def _as_system_admin(bind) -> str | None:
    previous = bind.scalar(sa.text(f"SELECT {UID}"))
    bind.execute(sa.text("SELECT set_config('app.current_user_id', 'system_admin', true)"))
    return previous


def _restore_identity(bind, previous: str | None) -> None:
    bind.execute(
        sa.text("SELECT set_config('app.current_user_id', :v, true)"),
        {"v": previous or ""},
    )


def upgrade() -> None:
    bind = op.get_bind()
    previous = _as_system_admin(bind)
    bind.execute(sa.text("""
        UPDATE device d
        SET model = NULL
        FROM device_type dt
        WHERE dt.id = d.device_type_id
          AND d.model IS NOT NULL
          AND lower(btrim(d.model)) = lower(btrim(dt.hardware_model))
    """))
    bind.execute(sa.text("UPDATE device SET model = NULL WHERE model IS NOT NULL AND btrim(model) = ''"))
    _restore_identity(bind, previous)


def downgrade() -> None:
    bind = op.get_bind()
    previous = _as_system_admin(bind)
    bind.execute(sa.text("""
        UPDATE device d
        SET model = dt.hardware_model
        FROM device_type dt
        WHERE dt.id = d.device_type_id
          AND d.model IS NULL
          AND dt.hardware_model IS NOT NULL
    """))
    _restore_identity(bind, previous)
