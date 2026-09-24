import importlib.util
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

REVISION = "0010"
DOWN_REVISION = "0009"


def _load_module():
    migration_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "0010_add_user_activity_timestamps.py"
    )
    spec = importlib.util.spec_from_file_location("add_user_activity_timestamps_revision", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_revision(fn, connection):
    module = _load_module()
    ctx = MigrationContext.configure(connection)
    with patch.object(module, "op", Operations(ctx)):
        getattr(module, fn)()


def _base_user_table(metadata):
    return sa.Table(
        "user",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
    )


def _engine():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    _base_user_table(metadata)
    metadata.create_all(engine)
    return engine


def _columns(connection):
    inspector = sa.inspect(connection)
    return {col["name"] for col in inspector.get_columns("user")}


def test_revision_is_chained_to_current_head():
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revision = script.get_revision(REVISION)

    assert revision is not None
    assert revision.down_revision == DOWN_REVISION
    heads = script.get_heads()
    assert len(heads) == 1
    assert REVISION in {r.revision for r in script.walk_revisions(base=DOWN_REVISION, head=heads[0])}


def test_upgrade_adds_nullable_activity_columns():
    engine = _engine()
    with engine.begin() as connection:
        assert "last_login_at" not in _columns(connection)
        assert "last_seen_at" not in _columns(connection)

        _run_revision("upgrade", connection)

        columns = _columns(connection)
        assert "last_login_at" in columns
        assert "last_seen_at" in columns


def test_upgrade_then_downgrade_round_trips_cleanly():
    engine = _engine()
    with engine.begin() as connection:
        _run_revision("upgrade", connection)
        _run_revision("downgrade", connection)

        columns = _columns(connection)
        assert "last_login_at" not in columns
        assert "last_seen_at" not in columns

        # Upgrading again after a downgrade must not fail (idempotent shape).
        _run_revision("upgrade", connection)
        columns = _columns(connection)
        assert "last_login_at" in columns
        assert "last_seen_at" in columns
