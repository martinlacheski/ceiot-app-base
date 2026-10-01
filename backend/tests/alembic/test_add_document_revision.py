import importlib.util
from pathlib import Path
from unittest.mock import patch

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

REVISION = "0011"
DOWN_REVISION = "0010"


def _load_module():
    path = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "0011_add_document.py"
    spec = importlib.util.spec_from_file_location("add_document_revision", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(fn, connection):
    module = _load_module()
    ctx = MigrationContext.configure(connection)
    with patch.object(module, "op", Operations(ctx)):
        getattr(module, fn)()


def _engine():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table("user", metadata, sa.Column("id", sa.Uuid(), primary_key=True))
    metadata.create_all(engine)
    return engine


def test_revision_is_chained_to_current_head():
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    revision = script.get_revision(REVISION)
    assert revision is not None and revision.down_revision == DOWN_REVISION
    # Later revisions extend the chain, so 0011 must stay an ancestor of the single head.
    heads = script.get_heads()
    assert len(heads) == 1
    assert REVISION in {r.revision for r in script.walk_revisions(base=DOWN_REVISION, head=heads[0])}


def test_upgrade_creates_document_table_with_constraints():
    engine = _engine()
    with engine.begin() as connection:
        _run("upgrade", connection)
        inspector = sa.inspect(connection)
        columns = {c["name"]: c for c in inspector.get_columns("document")}
        assert set(columns) == {
            "id", "title", "filename", "content_type", "size_bytes", "sha256", "storage_key",
            "uploaded_by", "is_active", "ingestion_status", "ingested_at", "error",
            "created_at", "updated_at",
        }
        assert columns["uploaded_by"]["nullable"] is True
        assert columns["ingested_at"]["nullable"] is True and columns["error"]["nullable"] is True
        assert any(i["unique"] and i["column_names"] == ["sha256"] for i in inspector.get_indexes("document"))

        insert = "INSERT INTO document (id, title, filename, content_type, size_bytes, sha256, storage_key{}) VALUES (:id, 't', 'f', 'text/plain', 1, :sha, 'k'{})"
        connection.execute(sa.text(insert.format("", "")), {"id": "1", "sha": "a" * 64})
        row = connection.execute(sa.text("SELECT ingestion_status, is_active FROM document")).one()
        assert tuple(row) == ("pending", 1)
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                connection.execute(sa.text(insert.format("", "")), {"id": "2", "sha": "a" * 64})
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    sa.text(insert.format(", ingestion_status", ", 'bogus'")), {"id": "3", "sha": "b" * 64}
                )


def test_upgrade_downgrade_upgrade_round_trips_cleanly():
    engine = _engine()
    with engine.begin() as connection:
        _run("upgrade", connection)
        _run("downgrade", connection)
        assert "document" not in sa.inspect(connection).get_table_names()
        _run("upgrade", connection)
        assert "document" in sa.inspect(connection).get_table_names()
