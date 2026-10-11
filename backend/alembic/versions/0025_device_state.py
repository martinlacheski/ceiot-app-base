"""the device's last-known runtime state moves to the 1:1 device_state table

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-11

Normalization item 4: thirteen columns of ``device`` were not the device's definition but the
last state its runtime reported (firmware, network, GPS fix, last connection and broker
presence). The MQTT runtime rewrote them on every telemetry message, so ``device.updated_at``
(``onupdate``) moved on every message and meant nothing. They now live in ``device_state``
(``device_id`` primary key and foreign key, ``ON DELETE CASCADE``), upserted by the runtime;
``device`` only changes on real edits. ``mac_address`` stays on ``device``: it identifies the
hardware unit, it is not volatile runtime state.

upgrade():

* creates ``device_state`` and copies the state of every device that ever reported something
  (any value set, or ``broker_connected`` true). A device that never reported gets no row:
  rows are created by the first runtime write and every reader LEFT JOINs (NULL / False).
  ``device_state.updated_at`` starts at the latest reported instant (else the migration time).
* row level security, ENABLE + FORCE, mirroring ``device``:
  ``device_state_read`` (SELECT) lets an identity read the state of exactly the devices it can
  read: the subquery over ``device`` is itself filtered by the device policies (members and
  guests), and the system identities see everything. ``device_state_member_access`` (ALL)
  repeats ``device_member_access`` through the device's environment, so members and the
  system identities (the MQTT runtime writes as ``system_mqtt``) write; guests only read.
* ``ai_read.devices`` is recreated over ``device LEFT JOIN device_state`` with the same
  columns, types, ``security_invoker`` option and grant; ``online`` is
  ``COALESCE(broker_connected, false)`` so a never-seen device still reads ``false``.
  ``ai_readonly`` gets SELECT on exactly the ``device_state`` columns the view and the
  policies read (``device_id``, ``broker_connected``, ``last_connection``).
* the thirteen columns are dropped from ``device`` (their column grants go with them).

downgrade() recreates the columns (``broker_connected`` NOT NULL, false for devices without a
state row), copies the state back, restores the 0022 view and the ``ai_readonly`` column grants
on ``device``, and drops ``device_state``.

Data movement runs as ``system_admin`` (transaction-local ``app.current_user_id``) because both
tables FORCE row level security and a non-superuser migration role would otherwise copy
nothing; the previous value is restored afterwards.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: str | Sequence[str] | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UID = "current_setting('app.current_user_id', true)"
SYSTEM = f"{UID} = ANY (ARRAY['system_mqtt', 'system_admin'])"
MEMBER_ENVIRONMENTS = (
    "SELECT eu.environment_id FROM public.environmentuser eu "
    f"WHERE eu.user_id::text = {UID} AND {UID} <> '' AND eu.is_active = true"
)

# (column, SQL type) in table order; ``broker_connected`` is the only NOT NULL one.
STATE_COLUMNS = (
    ("firmware_version", "varchar"),
    ("ip_address", "varchar"),
    ("rssi", "integer"),
    ("wifi_ssid", "varchar"),
    ("last_reset_reason", "varchar"),
    ("gps_latitude", "double precision"),
    ("gps_longitude", "double precision"),
    ("gps_updated_at", "timestamptz"),
    ("last_connection", "timestamptz"),
    ("broker_connected", "boolean"),
    ("broker_connected_at", "timestamptz"),
    ("broker_disconnected_at", "timestamptz"),
    ("broker_status_updated_at", "timestamptz"),
)
NAMES = ", ".join(name for name, _ in STATE_COLUMNS)
TIMESTAMPS = ("gps_updated_at", "last_connection", "broker_connected_at", "broker_disconnected_at",
              "broker_status_updated_at")

# Columns of device_state that ai_readonly reads: the view's and the policies' (device_id).
AI_READONLY_STATE_COLUMNS = ("device_id", "broker_connected", "last_connection")

STATE_VIEW = """
    CREATE VIEW ai_read.devices WITH (security_invoker = true) AS
    SELECT d.id, d.serial, d.name,
           dt.name AS device_type,
           d.environment_id,
           e.name AS environment_name,
           d.status::text AS status,
           d.enabled,
           d.is_active,
           COALESCE(ds.broker_connected, false) AS online,
           ds.last_connection
    FROM public.device d
    LEFT JOIN public.device_state ds ON ds.device_id = d.id
    LEFT JOIN public.device_type dt ON dt.id = d.device_type_id
    LEFT JOIN public.environment e ON e.id = d.environment_id
"""

# The 0012/0022 definition, restored by downgrade().
DEVICE_VIEW = """
    CREATE VIEW ai_read.devices WITH (security_invoker = true) AS
    SELECT d.id, d.serial, d.name,
           dt.name AS device_type,
           d.environment_id,
           e.name AS environment_name,
           d.status::text AS status,
           d.enabled,
           d.is_active,
           d.broker_connected AS online,
           d.last_connection
    FROM public.device d
    LEFT JOIN public.device_type dt ON dt.id = d.device_type_id
    LEFT JOIN public.environment e ON e.id = d.environment_id
"""


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
    columns = ",\n".join(
        f"{name} {kind} NOT NULL DEFAULT false" if name == "broker_connected" else f"{name} {kind}"
        for name, kind in STATE_COLUMNS
    )
    op.execute(f"""
        CREATE TABLE public.device_state (
            device_id uuid NOT NULL PRIMARY KEY REFERENCES public.device (id) ON DELETE CASCADE,
            {columns},
            updated_at timestamptz
        )
    """)
    op.execute("ALTER TABLE public.device_state ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.device_state FORCE ROW LEVEL SECURITY")
    op.execute(f"""
        CREATE POLICY device_state_read ON public.device_state FOR SELECT TO PUBLIC
        USING ({SYSTEM} OR device_id IN (SELECT d.id FROM public.device d))
    """)
    member_devices = f"SELECT d.id FROM public.device d WHERE d.environment_id IN ({MEMBER_ENVIRONMENTS})"
    op.execute(f"""
        CREATE POLICY device_state_member_access ON public.device_state FOR ALL TO PUBLIC
        USING ({SYSTEM} OR device_id IN ({member_devices}))
        WITH CHECK ({SYSTEM} OR device_id IN ({member_devices}))
    """)

    reported = " OR ".join(f"{name} IS NOT NULL" for name, _ in STATE_COLUMNS if name != "broker_connected")
    previous = _as_system_admin(bind)
    bind.execute(sa.text(f"""
        INSERT INTO public.device_state (device_id, {NAMES}, updated_at)
        SELECT id, {NAMES}, COALESCE(GREATEST({', '.join(TIMESTAMPS)}), CURRENT_TIMESTAMP)
        FROM public.device
        WHERE broker_connected OR {reported}
    """))
    _restore_identity(bind, previous)

    op.execute("DROP VIEW ai_read.devices")
    op.execute(STATE_VIEW)
    op.execute("GRANT SELECT ON ai_read.devices TO ai_readonly")
    op.execute(f"GRANT SELECT ({', '.join(AI_READONLY_STATE_COLUMNS)}) ON public.device_state TO ai_readonly")
    for name, _ in STATE_COLUMNS:
        op.drop_column("device", name)


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DROP VIEW ai_read.devices")
    for name, kind in STATE_COLUMNS:
        # broker_connected was NOT NULL without a server default: false fills the devices
        # without a state row, then the default goes away.
        default = " NOT NULL DEFAULT false" if name == "broker_connected" else ""
        op.execute(f"ALTER TABLE public.device ADD COLUMN {name} {kind}{default}")
    op.execute("ALTER TABLE public.device ALTER COLUMN broker_connected DROP DEFAULT")

    previous = _as_system_admin(bind)
    bind.execute(sa.text(f"""
        UPDATE public.device d
        SET {', '.join(f'{name} = ds.{name}' for name, _ in STATE_COLUMNS)}
        FROM public.device_state ds
        WHERE ds.device_id = d.id
    """))
    _restore_identity(bind, previous)

    op.execute(DEVICE_VIEW)
    op.execute("GRANT SELECT ON ai_read.devices TO ai_readonly")
    op.execute("GRANT SELECT (broker_connected, last_connection) ON public.device TO ai_readonly")
    op.execute("DROP TABLE public.device_state")
