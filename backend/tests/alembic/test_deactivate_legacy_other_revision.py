import importlib.util
import uuid
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

REVISION = "0004"
DOWN_REVISION = "0003"
LEGACY_OTHER_DEVICE_TYPE_ID = uuid.UUID("f2b0f5a8-0a91-4d2a-a3f3-04f6be5d2d13")


def _run_revision(fn, connection):
    migration_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "0004_deactivate_legacy_other_device_type.py"
    )
    spec = importlib.util.spec_from_file_location("deactivate_legacy_other_revision", migration_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    ctx = MigrationContext.configure(connection)
    with patch.object(module, "op", Operations(ctx)):
        getattr(module, fn)()


def _engine():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "device_type",
        metadata,
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("code", sa.String(), nullable=True, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
    )
    metadata.create_all(engine)
    return engine


def _is_active(connection):
    row = connection.execute(
        sa.text("SELECT is_active FROM device_type WHERE id = :id"),
        {"id": LEGACY_OTHER_DEVICE_TYPE_ID.hex},
    ).first()
    return bool(row.is_active) if row is not None else None


def test_revision_is_chained_to_current_head():
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revision = script.get_revision(REVISION)

    assert revision is not None
    assert revision.down_revision == DOWN_REVISION
    heads = script.get_heads()
    assert len(heads) == 1
    # Later revisions (e.g. 0005) may extend the chain past 0004, so 0004 is
    # no longer necessarily the head; it must still be an ancestor of it.
    assert REVISION in {r.revision for r in script.walk_revisions(base=DOWN_REVISION, head=heads[0])}


def test_upgrade_deactivates_the_other_row_when_present():
    engine = _engine()
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO device_type (id, name, code, is_active) "
                "VALUES (:id, 'Other', 'other', 1)"
            ),
            {"id": LEGACY_OTHER_DEVICE_TYPE_ID.hex},
        )

        _run_revision("upgrade", connection)

        assert _is_active(connection) is False


def test_upgrade_is_idempotent_and_noop_when_row_missing():
    engine = _engine()
    with engine.begin() as connection:
        _run_revision("upgrade", connection)
        _run_revision("upgrade", connection)

        assert _is_active(connection) is None


def test_upgrade_leaves_other_catalog_rows_untouched():
    engine = _engine()
    other_id = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO device_type (id, name, code, is_active) "
                "VALUES (:id, 'Custom', NULL, 1)"
            ),
            {"id": other_id.hex},
        )
        connection.execute(
            sa.text(
                "INSERT INTO device_type (id, name, code, is_active) "
                "VALUES (:id, 'Other', 'other', 1)"
            ),
            {"id": LEGACY_OTHER_DEVICE_TYPE_ID.hex},
        )

        _run_revision("upgrade", connection)

        row = connection.execute(
            sa.text("SELECT is_active FROM device_type WHERE id = :id"),
            {"id": other_id.hex},
        ).first()
        assert bool(row.is_active) is True


def test_downgrade_reactivates_the_other_row():
    engine = _engine()
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO device_type (id, name, code, is_active) "
                "VALUES (:id, 'Other', 'other', 1)"
            ),
            {"id": LEGACY_OTHER_DEVICE_TYPE_ID.hex},
        )
        _run_revision("upgrade", connection)
        assert _is_active(connection) is False

        _run_revision("downgrade", connection)

        assert _is_active(connection) is True


def test_downgrade_is_noop_when_row_missing():
    engine = _engine()
    with engine.begin() as connection:
        _run_revision("downgrade", connection)

        assert _is_active(connection) is None
