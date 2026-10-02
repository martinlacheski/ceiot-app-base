"""device_type becomes the device template: compatible sensors, kit and telemetry defaults

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-02

``device_type`` gains ``description``, ``hardware_model``, ``telemetry_interval_s``,
``offline_after_s``, ``min_sensors``, ``config_template`` (JSONB object) and ``created_at``.
The new N:M table ``device_type_sensor`` lists which sensor models a type can carry
(``required``, ``max_count``, ``included_by_default``).

The old hard-coded "Ambiental needs at least one sensor" rule becomes data:
Ambiental gets ``min_sensors = 1`` and four compatible models (DHT11, DHT22, BMP280 and
BME280, at most two of each; only BME280 is part of the default kit).

``device_type.hardware_model`` is backfilled from the most common non-blank ``device.model``
of each type (ties broken alphabetically) where it is empty. ``device.model`` is NOT dropped:
the board revision can legitimately differ per unit, so it stays as the per-device value and
the type's hardware model is only its default.

RLS: ``device_type`` itself has no row level security (it is a global catalog written through
the API only). ``device_type_sensor`` follows its sibling catalog ``sensor_variable``: readable
by any authenticated identity, writable by the system identities and administrators.
RLS is disabled on ``device`` only inside this transaction for the backfill read.
"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0018"
down_revision: Union[str, Sequence[str], None] = "0017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AMBIENTAL_ID = uuid.UUID("6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c32")
# Frozen seed (sensor ids come from 0005).
SENSOR_IDS = {
    "dht11": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0011"),
    "dht22": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0012"),
    "bmp280": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0013"),
    "bme280": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0014"),
}
DEFAULT_KIT = {"bme280"}
SEED_MAX_COUNT = 2


def _identity_fragments():
    uid = "current_setting('app.current_user_id', true)"
    system = f"{uid} = ANY (ARRAY['system_mqtt', 'system_admin'])"
    admin = f"EXISTS (SELECT 1 FROM public.\"user\" u WHERE u.id::text = {uid} AND u.is_admin AND u.is_active)"
    return uid, system, admin


def upgrade() -> None:
    op.add_column("device_type", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("device_type", sa.Column("hardware_model", sa.Text(), nullable=True))
    op.add_column("device_type", sa.Column("telemetry_interval_s", sa.Integer(), nullable=True))
    op.add_column("device_type", sa.Column("offline_after_s", sa.Integer(), nullable=True))
    op.add_column("device_type", sa.Column("min_sensors", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("device_type", sa.Column("config_template", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))
    op.add_column("device_type", sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
    op.create_check_constraint(
        "ck_device_type_telemetry_interval", "device_type",
        "telemetry_interval_s IS NULL OR telemetry_interval_s BETWEEN 5 AND 86400")
    op.create_check_constraint(
        "ck_device_type_offline_after", "device_type",
        "offline_after_s IS NULL OR offline_after_s BETWEEN 10 AND 604800")
    op.create_check_constraint("ck_device_type_min_sensors", "device_type", "min_sensors >= 0")
    op.create_check_constraint(
        "ck_device_type_config_template_object", "device_type", "jsonb_typeof(config_template) = 'object'")

    op.create_table(
        "device_type_sensor",
        sa.Column("device_type_id", sa.Uuid(), sa.ForeignKey("device_type.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("sensor_id", sa.Uuid(), sa.ForeignKey("sensor.id"), primary_key=True),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("max_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("included_by_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.CheckConstraint("max_count >= 1", name="ck_device_type_sensor_max_count"),
    )
    op.create_index("ix_device_type_sensor_sensor_id", "device_type_sensor", ["sensor_id"])

    uid, system, admin = _identity_fragments()
    op.execute('ALTER TABLE public."device_type_sensor" ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE public."device_type_sensor" FORCE ROW LEVEL SECURITY')
    op.execute(f"CREATE POLICY catalog_read ON public.device_type_sensor FOR SELECT TO PUBLIC USING ({uid} IS NOT NULL AND {uid} <> '')")
    op.execute(f"CREATE POLICY catalog_insert ON public.device_type_sensor FOR INSERT TO PUBLIC WITH CHECK ({system} OR {admin})")
    op.execute(f"CREATE POLICY catalog_update ON public.device_type_sensor FOR UPDATE TO PUBLIC USING ({system} OR {admin}) WITH CHECK ({system} OR {admin})")
    op.execute(f"CREATE POLICY catalog_delete ON public.device_type_sensor FOR DELETE TO PUBLIC USING ({system} OR {admin})")

    # Backfill hardware_model from device.model (RLS on device would hide rows from this role).
    op.execute("ALTER TABLE public.device DISABLE ROW LEVEL SECURITY")
    op.execute("""
        UPDATE public.device_type AS dt
        SET hardware_model = ranked.model
        FROM (
            SELECT DISTINCT ON (device_type_id) device_type_id, model
            FROM (
                SELECT device_type_id, btrim(model) AS model, count(*) AS uses
                FROM public.device
                WHERE model IS NOT NULL AND btrim(model) <> ''
                GROUP BY device_type_id, btrim(model)
            ) AS counted
            ORDER BY device_type_id, uses DESC, model ASC
        ) AS ranked
        WHERE dt.id = ranked.device_type_id
          AND (dt.hardware_model IS NULL OR dt.hardware_model = '')
    """)
    op.execute("ALTER TABLE public.device ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.device FORCE ROW LEVEL SECURITY")

    # Ambiental: the data-driven replacement of the hard-coded "at least one sensor" rule.
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE device_type SET min_sensors = 1 WHERE id = :id"), {"id": AMBIENTAL_ID})
    for code, sensor_id in SENSOR_IDS.items():
        bind.execute(
            sa.text(
                "INSERT INTO device_type_sensor (device_type_id, sensor_id, required, max_count, included_by_default) "
                "SELECT :type_id, s.id, false, :max_count, :default FROM sensor s WHERE s.id = :sensor_id "
                "AND EXISTS (SELECT 1 FROM device_type WHERE id = :type_id)"
            ),
            {"type_id": AMBIENTAL_ID, "sensor_id": sensor_id, "max_count": SEED_MAX_COUNT, "default": code in DEFAULT_KIT},
        )


def downgrade() -> None:
    op.drop_table("device_type_sensor")
    for name in ("ck_device_type_config_template_object", "ck_device_type_min_sensors",
                 "ck_device_type_offline_after", "ck_device_type_telemetry_interval"):
        op.drop_constraint(name, "device_type", type_="check")
    for column in ("created_at", "config_template", "min_sensors", "offline_after_s",
                   "telemetry_interval_s", "hardware_model", "description"):
        op.drop_column("device_type", column)
