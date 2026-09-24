"""Contract for the additive environmental sensor migration."""

import uuid
import importlib.util
from pathlib import Path
from unittest.mock import patch

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory


ROOT = Path(__file__).resolve().parents[2]
REVISION = ROOT / "alembic/versions/0005_environmental_sensor_model.py"


def test_revision_is_chained_and_reversible():
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    heads = script.get_heads()
    assert len(heads) == 1
    # Later revisions (e.g. 0006) may extend the chain past 0005, so 0005 is
    # no longer necessarily the head; it must still be an ancestor of it.
    assert "0005" in {r.revision for r in script.walk_revisions(base="0004", head=heads[0])}
    assert script.get_revision("0005").down_revision == "0004"
    source = REVISION.read_text()
    assert "def upgrade()" in source
    assert "def downgrade()" in source
    for table in ("variable", "sensor", "sensor_variable", "device_sensor", "telemetry"):
        assert f'create_table("{table}"' in source or (
            table in {"variable", "sensor"} and f'("{table}", [sa.Column' in source
        )
        assert f'drop_table("{table}"' in source
    assert "create_hypertable('telemetry', 'time'" in source
    assert "set_telemetry_environment_id" in source
    assert "jsonb_path_ops" in source
    assert "FORCE ROW LEVEL SECURITY" in source


def test_catalog_seed_has_stable_identifiers_and_expected_ranges():
    from app.api.sensor_catalog.constants import SENSOR_IDS, VARIABLE_IDS, SENSOR_VARIABLE_SPECS

    assert set(VARIABLE_IDS) == {"temperature", "relative_humidity", "pressure"}
    assert set(SENSOR_IDS) == {"dht11", "dht22", "bmp280", "bme280"}
    assert len(set(VARIABLE_IDS.values()) | set(SENSOR_IDS.values())) == 7
    assert all(isinstance(value, uuid.UUID) for value in (*VARIABLE_IDS.values(), *SENSOR_IDS.values()))
    assert {(s, v): (lo, hi) for s, v, lo, hi, *_ in SENSOR_VARIABLE_SPECS} == {
        ("dht11", "temperature"): (0, 50),
        ("dht11", "relative_humidity"): (20, 90),
        ("dht22", "temperature"): (-40, 80),
        ("dht22", "relative_humidity"): (0, 100),
        ("bmp280", "temperature"): (-40, 85),
        ("bmp280", "pressure"): (300, 1100),
        ("bme280", "temperature"): (-40, 85),
        ("bme280", "relative_humidity"): (0, 100),
        ("bme280", "pressure"): (300, 1100),
    }


def test_device_sensor_key_is_slug_and_telemetry_requires_object():
    from pydantic import ValidationError
    from app.api.sensor_catalog.models import DeviceSensor
    from app.api.sensor.models import Telemetry

    good = DeviceSensor.model_validate({"device_id": uuid.uuid4(), "sensor_id": uuid.uuid4(), "key": "dht22_2"})
    assert good.key == "dht22_2"
    for bad in ("DHT22", "dht 22", "-dht", "dht/22"):
        try:
            DeviceSensor.model_validate({"device_id": uuid.uuid4(), "sensor_id": uuid.uuid4(), "key": bad})
        except ValidationError:
            pass
        else:
            raise AssertionError(f"accepted invalid key {bad!r}")
    assert Telemetry.model_validate({"device_serial": "TEST", "values": {"dht22": {"temperature": 23.4}}}).values


def test_downgrade_and_upgrade_round_trip_in_transaction(postgres_rls_config):
    """Exercise both directions on the migrated test DB, then roll back all DDL."""
    from sqlalchemy.engine import make_url

    url = make_url(postgres_rls_config.admin_url)
    if url.drivername == "postgresql+asyncpg":
        url = url.set(drivername="postgresql+psycopg")
    engine = sa.create_engine(url)
    spec = importlib.util.spec_from_file_location("environmental_revision", REVISION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                operations = Operations(MigrationContext.configure(connection))
                with patch.object(module, "op", operations):
                    module.downgrade()
                    assert connection.scalar(sa.text("SELECT to_regclass('public.telemetry')")) is None
                    assert connection.scalar(sa.text("SELECT is_active FROM device_type WHERE code='relay_1'")) is True
                    module.upgrade()
                    assert connection.scalar(sa.text("SELECT to_regclass('public.telemetry')")) is not None
                    assert connection.scalar(sa.text("SELECT count(*) FROM sensor_variable")) == 9
                    assert connection.scalar(sa.text("SELECT is_active FROM device_type WHERE code='environmental'")) is True
            finally:
                transaction.rollback()
    finally:
        engine.dispose()
