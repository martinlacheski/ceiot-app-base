"""deviceoperation.device_id: a real FK to device next to the serial

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-02

``deviceoperation`` only carried ``device_serial`` (no FK), unlike ``telemetry`` and
``sensorreading``. This adds a nullable ``device_id`` FK (ON DELETE SET NULL, like the
table's ``environment_id``) and backfills it from the serial. ``device_serial`` stays:
former-owner history is read by serial and must outlive the device row.

Orphans (serials with no device row, e.g. a decommissioned or never-registered device)
keep ``device_id`` NULL; that is deliberate, not a data error.

Hypertable notes: ``deviceoperation`` is a TimescaleDB hypertable (no compression). A
foreign key from a hypertable to a regular table is supported. The backfill runs with
row level security disabled inside this transaction because the baseline has no UPDATE
policy on history tables (same technique as 0003).

The BEFORE INSERT trigger from 0003 is replaced so ingestion paths that only know the
serial still get ``device_id`` (and ``environment_id``) filled consistently.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0015"
down_revision: Union[str, Sequence[str], None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Mirrors DeviceService.normalize_serial: uppercase, no hyphens, IOT-XXXX-XXXX grouping.
_CLEAN = "upper(replace(o.device_serial, '-', ''))"
_CANONICAL_SERIAL = (
    f"CASE WHEN left({_CLEAN}, 3) = 'IOT' AND length({_CLEAN}) = 11 "
    f"THEN 'IOT-' || substr({_CLEAN}, 4, 4) || '-' || substr({_CLEAN}, 8, 4) "
    f"ELSE {_CLEAN} END"
)


def upgrade() -> None:
    op.add_column("deviceoperation", sa.Column("device_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_deviceoperation_device_id_device",
        "deviceoperation",
        "device",
        ["device_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_deviceoperation_device_id"), "deviceoperation", ["device_id"], unique=False
    )

    op.execute("ALTER TABLE public.deviceoperation DISABLE ROW LEVEL SECURITY")
    op.execute(f"""
        UPDATE public.deviceoperation AS o
        SET device_id = d.id
        FROM public.device AS d
        WHERE o.device_id IS NULL
          AND o.device_serial IS NOT NULL
          AND d.serial = {_CANONICAL_SERIAL}
    """)
    op.execute("ALTER TABLE public.deviceoperation ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.deviceoperation FORCE ROW LEVEL SECURITY")

    op.execute("""
        CREATE OR REPLACE FUNCTION public.set_deviceoperation_environment_id()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
        BEGIN
            IF NEW.device_id IS NULL AND NEW.device_serial IS NOT NULL THEN
                SELECT d.id
                INTO NEW.device_id
                FROM public.device AS d
                WHERE d.serial = NEW.device_serial
                LIMIT 1;
            END IF;
            IF NEW.environment_id IS NULL THEN
                SELECT d.environment_id
                INTO NEW.environment_id
                FROM public.device AS d
                WHERE (NEW.device_id IS NOT NULL AND d.id = NEW.device_id)
                   OR (NEW.device_id IS NULL AND d.serial = NEW.device_serial)
                LIMIT 1;
            END IF;
            RETURN NEW;
        END;
        $$
    """)


def downgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION public.set_deviceoperation_environment_id()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
        BEGIN
            IF NEW.environment_id IS NULL THEN
                SELECT d.environment_id
                INTO NEW.environment_id
                FROM public.device AS d
                WHERE d.serial = NEW.device_serial
                LIMIT 1;
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.drop_index(op.f("ix_deviceoperation_device_id"), table_name="deviceoperation")
    op.drop_constraint(
        "fk_deviceoperation_device_id_device", "deviceoperation", type_="foreignkey"
    )
    op.drop_column("deviceoperation", "device_id")
