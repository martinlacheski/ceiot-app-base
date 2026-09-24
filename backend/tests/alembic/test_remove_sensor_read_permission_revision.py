import importlib.util
import uuid
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

REVISION = "0009"
DOWN_REVISION = "0008"

SENSOR_READ = "sensor:read"
DEVICE_READ = "device:read"


def _run_revision(fn, connection):
    migration_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "0009_remove_sensor_read_permission.py"
    )
    spec = importlib.util.spec_from_file_location("remove_sensor_read_permission_revision", migration_path)
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


def _insert_user(connection, user_id, *, permissions):
    metadata = sa.MetaData()
    table = _user_table(metadata)
    connection.execute(
        table.insert(),
        {"id": user_id, "permissions": list(permissions)},
    )


def test_revision_is_chained_to_current_head():
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revision = script.get_revision(REVISION)

    assert revision is not None
    assert revision.down_revision == DOWN_REVISION
    heads = script.get_heads()
    assert len(heads) == 1
    assert REVISION in {r.revision for r in script.walk_revisions(base=DOWN_REVISION, head=heads[0])}


def test_upgrade_removes_sensor_read_from_holders():
    engine = _engine()
    user_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, user_id, permissions=["user:me", SENSOR_READ, DEVICE_READ])

        _run_revision("upgrade", connection)

        assert _permissions(connection, user_id) == {"user:me", DEVICE_READ}


def test_upgrade_leaves_users_without_it_untouched():
    engine = _engine()
    user_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, user_id, permissions=["user:me"])

        _run_revision("upgrade", connection)

        assert _permissions(connection, user_id) == {"user:me"}


def test_upgrade_is_idempotent():
    engine = _engine()
    user_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, user_id, permissions=[SENSOR_READ])

        _run_revision("upgrade", connection)
        first = _permissions(connection, user_id)
        _run_revision("upgrade", connection)
        second = _permissions(connection, user_id)

        assert first == second == set()


def test_downgrade_restores_sensor_read_for_device_read_holders():
    engine = _engine()
    user_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, user_id, permissions=["user:me", DEVICE_READ])

        _run_revision("downgrade", connection)

        assert _permissions(connection, user_id) == {"user:me", DEVICE_READ, SENSOR_READ}


def test_downgrade_does_not_grant_it_without_device_read():
    engine = _engine()
    user_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, user_id, permissions=["user:me"])

        _run_revision("downgrade", connection)

        assert _permissions(connection, user_id) == {"user:me"}


def test_downgrade_is_idempotent():
    engine = _engine()
    user_id = uuid.uuid4()
    with engine.begin() as connection:
        _insert_user(connection, user_id, permissions=[DEVICE_READ])

        _run_revision("downgrade", connection)
        first = _permissions(connection, user_id)
        _run_revision("downgrade", connection)
        second = _permissions(connection, user_id)

        assert first == second == {DEVICE_READ, SENSOR_READ}
