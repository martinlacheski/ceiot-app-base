"""firmware catalog and OTA attempts

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-07

``firmware_release`` is one uploaded ESP32 image of the single device firmware (``esp32/``,
``project(iot_device)``), identified by the version its own descriptor carries (unique).
``firmware_update`` is one attempt to install a release on one device: ``request_id`` travels in
``ota/command`` and comes back in every ``ota/status``; ``download_token`` is the only credential
of the short download URL; ``operation_id`` points at the device history record of the outcome
(``deviceoperation`` is a hypertable keyed by ``(time, id)``, so it is not a foreign key).

``deviceoperationtype`` gains ``FIRMWARE_UPDATE`` (the enum stores member names).

RLS: firmware data is reachable only through admin endpoints and the MQTT runtime, so both tables
follow ``document``: one policy for every command, open to the system identities and active
administrators only. The device download route reads them with the ``system_mqtt`` identity.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0019"
down_revision: Union[str, Sequence[str], None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATES = (
    "requested", "accepted", "rejected", "downloading", "verifying",
    "installing", "rebooting", "succeeded", "failed", "rolled_back",
)


def _admin_only(table: str) -> None:
    uid = "current_setting('app.current_user_id', true)"
    system = f"{uid} = ANY (ARRAY['system_mqtt', 'system_admin'])"
    admin = f"EXISTS (SELECT 1 FROM public.\"user\" u WHERE u.id::text = {uid} AND u.is_admin AND u.is_active)"
    op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY {table}_admin_only ON public.{table} FOR ALL TO PUBLIC "
        f"USING ({system} OR {admin}) WITH CHECK ({system} OR {admin})"
    )


def upgrade() -> None:
    op.create_table(
        "firmware_release",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("storage_key", sa.String(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint("version", name="uq_firmware_release_version"),
        # 0x400000: the ota_0/ota_1 partitions of esp32/partitions.csv.
        sa.CheckConstraint("size > 0 AND size <= 4194304", name="ck_firmware_release_size"),
    )

    op.create_table(
        "firmware_update",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("request_id", sa.String(), nullable=False),
        sa.Column("device_id", sa.Uuid(), sa.ForeignKey("device.id"), nullable=False),
        sa.Column("device_serial", sa.String(), nullable=False),
        sa.Column("release_id", sa.Uuid(), sa.ForeignKey("firmware_release.id"), nullable=False),
        sa.Column("state", sa.String(), nullable=False, server_default="requested"),
        sa.Column("progress", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(), nullable=True),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("running_version", sa.String(), nullable=True),
        sa.Column("target_version", sa.String(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("user.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("download_token", sa.String(), nullable=True),
        sa.Column("download_expires_at", sa.DateTime(), nullable=True),
        sa.Column("downloaded_at", sa.DateTime(), nullable=True),
        sa.Column("operation_id", sa.Uuid(), nullable=True),
        sa.UniqueConstraint("request_id", name="uq_firmware_update_request_id"),
        sa.CheckConstraint(
            "state IN ({})".format(", ".join(f"'{state}'" for state in STATES)),
            name="ck_firmware_update_state",
        ),
        sa.CheckConstraint(
            "progress IS NULL OR (progress >= 0 AND progress <= 100)", name="ck_firmware_update_progress"
        ),
    )
    op.create_index("ix_firmware_update_device_id", "firmware_update", ["device_id"])
    op.create_index("ix_firmware_update_device_serial", "firmware_update", ["device_serial"])
    op.create_index("ix_firmware_update_download_token", "firmware_update", ["download_token"], unique=True)

    if op.get_bind().dialect.name == "postgresql":
        _admin_only("firmware_release")
        _admin_only("firmware_update")
        # Allowed inside the migration transaction (PostgreSQL >= 12); the value is only used by
        # the application afterwards. IF NOT EXISTS: the value survives a downgrade (see below).
        op.execute("ALTER TYPE deviceoperationtype ADD VALUE IF NOT EXISTS 'FIRMWARE_UPDATE'")


def downgrade() -> None:
    # Dropping the tables also drops their policies and indexes.
    op.drop_table("firmware_update")
    op.drop_table("firmware_release")
    # PostgreSQL cannot remove a value from an enum type: 'FIRMWARE_UPDATE' stays in
    # deviceoperationtype, and so do the history rows that use it. Code older than this revision
    # cannot read those rows (its DeviceOperationType has no such member): delete them by hand
    # (`DELETE FROM deviceoperation WHERE operation_type = 'FIRMWARE_UPDATE'`) if that matters.
    # The upgrade re-adds the value with IF NOT EXISTS, so a downgrade/upgrade round trip works.
