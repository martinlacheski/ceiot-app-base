"""add device history environment snapshot

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rls_fragments() -> tuple[str, str, str, str, str]:
    """Return the identity and access fragments used by the baseline policies."""
    uid = "current_setting('app.current_user_id', true)"
    system = f"{uid} = ANY (ARRAY['system_mqtt', 'system_admin'])"
    member_environments = (
        "SELECT eu.environment_id FROM environmentuser eu "
        f"WHERE eu.user_id::text = {uid} AND {uid} <> '' AND eu.is_active = true"
    )
    guest_environments = (
        "SELECT sgr.scope_id FROM scoped_guest_relation sgr "
        f"WHERE sgr.scope_type = 'environment' AND sgr.guest_user_id::text = {uid} "
        f"AND sgr.is_active = true AND sgr.access_starts_at <= CURRENT_TIMESTAMP AND {uid} <> ''"
    )
    guest_devices = (
        "SELECT sgr.scope_id FROM scoped_guest_relation sgr "
        f"WHERE sgr.scope_type = 'device' AND sgr.guest_user_id::text = {uid} "
        f"AND sgr.is_active = true AND sgr.access_starts_at <= CURRENT_TIMESTAMP AND {uid} <> ''"
    )
    return uid, system, member_environments, guest_environments, guest_devices


def upgrade() -> None:
    """Snapshot device ownership on history rows and scope RLS to the snapshot."""
    op.add_column(
        "sensorreading",
        sa.Column("environment_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_sensorreading_environment_id_environment",
        "sensorreading",
        "environment",
        ["environment_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_sensorreading_environment_id"),
        "sensorreading",
        ["environment_id"],
        unique=False,
    )

    op.add_column(
        "deviceoperation",
        sa.Column("environment_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_deviceoperation_environment_id_environment",
        "deviceoperation",
        "environment",
        ["environment_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_deviceoperation_environment_id"),
        "deviceoperation",
        ["environment_id"],
        unique=False,
    )

    op.execute("""
        CREATE FUNCTION public.set_sensorreading_environment_id()
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
                WHERE (NEW.device_id IS NOT NULL AND d.id = NEW.device_id)
                   OR (NEW.device_id IS NULL AND d.serial = NEW.device_serial)
                LIMIT 1;
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER set_sensorreading_environment_id
        BEFORE INSERT ON public.sensorreading
        FOR EACH ROW
        EXECUTE FUNCTION public.set_sensorreading_environment_id()
    """)

    op.execute("""
        CREATE FUNCTION public.set_deviceoperation_environment_id()
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
    op.execute("""
        CREATE TRIGGER set_deviceoperation_environment_id
        BEFORE INSERT ON public.deviceoperation
        FOR EACH ROW
        EXECUTE FUNCTION public.set_deviceoperation_environment_id()
    """)

    # A fresh database has no history. If a development database does, the
    # device's current environment is the only honest one-time fallback. RLS
    # is disabled only inside this transactional migration because the
    # baseline intentionally has no UPDATE policies for history tables.
    op.execute("ALTER TABLE public.sensorreading DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.deviceoperation DISABLE ROW LEVEL SECURITY")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM public.sensorreading WHERE environment_id IS NULL
            ) THEN
                UPDATE public.sensorreading AS sr
                SET environment_id = d.environment_id
                FROM public.device AS d
                WHERE sr.environment_id IS NULL
                  AND (
                      (sr.device_id IS NOT NULL AND d.id = sr.device_id)
                      OR (sr.device_id IS NULL AND d.serial = sr.device_serial)
                  );
            END IF;

            IF EXISTS (
                SELECT 1 FROM public.deviceoperation WHERE environment_id IS NULL
            ) THEN
                UPDATE public.deviceoperation AS operation
                SET environment_id = d.environment_id
                FROM public.device AS d
                WHERE operation.environment_id IS NULL
                  AND d.serial = operation.device_serial;
            END IF;
        END
        $$
    """)
    op.execute("ALTER TABLE public.sensorreading ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.sensorreading FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.deviceoperation ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.deviceoperation FORCE ROW LEVEL SECURITY")

    _, system, member_environments, guest_environments, guest_devices = (
        _rls_fragments()
    )

    op.execute("DROP POLICY device_data_access ON sensorreading")
    op.execute(f"""
        CREATE POLICY device_data_access ON sensorreading FOR SELECT TO PUBLIC
        USING ({system}
            OR environment_id IN ({member_environments})
            OR environment_id IN ({guest_environments})
            OR device_id IN ({guest_devices})
        )
    """)

    op.execute("DROP POLICY operation_access ON deviceoperation")
    op.execute(f"""
        CREATE POLICY operation_access ON deviceoperation FOR SELECT TO PUBLIC
        USING ({system}
            OR environment_id IN ({member_environments})
            OR environment_id IN ({guest_environments})
            OR device_serial IN (
                SELECT d.serial FROM device d WHERE d.id IN ({guest_devices})
            )
        )
    """)


def downgrade() -> None:
    """Restore the baseline live-device RLS policies and remove snapshots."""
    _, system, member_environments, guest_environments, guest_devices = (
        _rls_fragments()
    )

    op.execute("DROP POLICY operation_access ON deviceoperation")
    op.execute(f"""
        CREATE POLICY operation_access ON deviceoperation FOR SELECT TO PUBLIC
        USING ({system} OR device_serial IN (
            SELECT d.serial FROM device d
            WHERE d.environment_id IN ({member_environments})
               OR d.environment_id IN ({guest_environments})
               OR d.id IN ({guest_devices})
        ))
    """)

    op.execute("DROP POLICY device_data_access ON sensorreading")
    op.execute(f"""
        CREATE POLICY device_data_access ON sensorreading FOR SELECT TO PUBLIC
        USING ({system} OR device_id IN (
            SELECT d.id FROM device d
            WHERE d.environment_id IN ({member_environments})
               OR d.environment_id IN ({guest_environments})
               OR d.id IN ({guest_devices})
        ))
    """)

    op.execute(
        "DROP TRIGGER set_deviceoperation_environment_id ON public.deviceoperation"
    )
    op.execute("DROP FUNCTION public.set_deviceoperation_environment_id()")
    op.execute(
        "DROP TRIGGER set_sensorreading_environment_id ON public.sensorreading"
    )
    op.execute("DROP FUNCTION public.set_sensorreading_environment_id()")

    op.drop_index(
        op.f("ix_deviceoperation_environment_id"),
        table_name="deviceoperation",
    )
    op.drop_constraint(
        "fk_deviceoperation_environment_id_environment",
        "deviceoperation",
        type_="foreignkey",
    )
    op.drop_column("deviceoperation", "environment_id")

    op.drop_index(
        op.f("ix_sensorreading_environment_id"),
        table_name="sensorreading",
    )
    op.drop_constraint(
        "fk_sensorreading_environment_id_environment",
        "sensorreading",
        type_="foreignkey",
    )
    op.drop_column("sensorreading", "environment_id")
