import importlib.util
import uuid
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

REVISION = "0006"
DOWN_REVISION = "0005"

SENSOR_CATALOG_READ = "sensor_catalog:read"
DEVICE_SENSOR_READ = "device_sensor:read"
DEVICE_SENSOR_WRITE = "device_sensor:write"
TELEMETRY_READ = "telemetry:read"
NEW_CODES = {SENSOR_CATALOG_READ, DEVICE_SENSOR_READ, DEVICE_SENSOR_WRITE, TELEMETRY_READ}


def _run_revision(fn, connection):
    migration_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "0006_backfill_sensor_permission_grants.py"
    )
    spec = importlib.util.spec_from_file_location("backfill_sensor_permission_grants_revision", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    ctx = MigrationContext.configure(connection)
    with patch.object(module, "op", Operations(ctx)):
        getattr(module, fn)()


def _user_table(metadata):
    return sa.Table(
        "user",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("permissions", sa.JSON(), nullable=True),
    )


def _engine():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    _user_table(metadata)
    metadata.create_all(engine)
    return engine


def _permissions(connection, user_id):
    metadata = sa.MetaData()
    table = _user_table(metadata)
    row = connection.execute(
        sa.select(table.c.permissions).where(table.c.id == user_id)
    ).first()
    return set(row.permissions or []) if row is not None else None


def _insert_user(connection, user_id, *, is_admin, permissions):
    metadata = sa.MetaData()
    table = _user_table(metadata)
    connection.execute(
        table.insert(),
        {"id": user_id, "is_admin": is_admin, "permissions": list(permissions)},
    )


def test_revision_is_chained_to_current_head():
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revision = script.get_revision(REVISION)

    assert revision is not None
    assert revision.down_revision == DOWN_REVISION
    heads = script.get_heads()
    assert len(heads) == 1
    assert REVISION in {r.revision for r in script.walk_revisions(base=DOWN_REVISION, head=heads[0])}


def test_upgrade_grants_all_new_codes_to_admins():
    engine = _engine()
    admin_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, admin_id, is_admin=True, permissions=["user:me"])

        _run_revision("upgrade", connection)

        assert _permissions(connection, admin_id) >= NEW_CODES


def test_upgrade_grants_read_codes_to_users_with_device_read_only():
    engine = _engine()
    reader_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, reader_id, is_admin=False, permissions=["user:me", "device:read"])

        _run_revision("upgrade", connection)

        granted = _permissions(connection, reader_id)
        assert {SENSOR_CATALOG_READ, DEVICE_SENSOR_READ, TELEMETRY_READ} <= granted
        assert DEVICE_SENSOR_WRITE not in granted


def test_upgrade_grants_write_code_to_users_who_can_update_devices():
    engine = _engine()
    updater_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(
            connection, updater_id, is_admin=False,
            permissions=["user:me", "device:read", "device:update"],
        )

        _run_revision("upgrade", connection)

        assert DEVICE_SENSOR_WRITE in _permissions(connection, updater_id)


def test_upgrade_leaves_users_without_device_access_untouched():
    engine = _engine()
    unrelated_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, unrelated_id, is_admin=False, permissions=["user:me"])

        _run_revision("upgrade", connection)

        assert _permissions(connection, unrelated_id) == {"user:me"}


def test_upgrade_is_idempotent():
    engine = _engine()
    admin_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, admin_id, is_admin=True, permissions=["user:me"])

        _run_revision("upgrade", connection)
        first = _permissions(connection, admin_id)
        _run_revision("upgrade", connection)
        second = _permissions(connection, admin_id)

        assert first == second


def test_downgrade_removes_exactly_the_new_codes():
    engine = _engine()
    admin_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(
            connection, admin_id, is_admin=True,
            permissions=["user:me", *NEW_CODES],
        )

        _run_revision("downgrade", connection)

        assert _permissions(connection, admin_id) == {"user:me"}


def test_downgrade_is_noop_when_codes_absent():
    engine = _engine()
    user_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, user_id, is_admin=False, permissions=["user:me"])

        _run_revision("downgrade", connection)

        assert _permissions(connection, user_id) == {"user:me"}
