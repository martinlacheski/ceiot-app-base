"""Data handling and round trip of migrations 0015-0017 on a scratch database.

A throwaway ``<dev_db>_n1mig`` database is migrated to 0014, filled with the kinds of
violations a real database may hold, upgraded, downgraded and upgraded again. It never
touches the dev or the shared test database.
"""

import os
import subprocess
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings

BACKEND_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def scratch_url():
    dev_url = make_url(settings.DATABASE_URL)
    if dev_url.get_backend_name() != "postgresql":
        pytest.skip("requires PostgreSQL")
    dev_sync = dev_url.set(drivername="postgresql+psycopg")
    name = f"{dev_url.database}_n1mig"
    scratch = dev_sync.set(database=name)
    try:
        maintenance = create_engine(dev_sync, isolation_level="AUTOCOMMIT")
        with maintenance.connect() as connection:
            connection.exec_driver_sql(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %(n)s AND pid <> pg_backend_pid()",
                {"n": name},
            )
            connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
    except SQLAlchemyError as exc:
        pytest.skip(f"cannot create the scratch database: {type(exc).__name__}")
    yield scratch
    with maintenance.connect() as connection:
        connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
    maintenance.dispose()


def _alembic(url, *args):
    env = dict(os.environ, ALEMBIC_DATABASE_URL=url.render_as_string(hide_password=False))
    return subprocess.run(["alembic", *args], cwd=str(BACKEND_ROOT), env=env, capture_output=True, text=True)


def _must(url, *args):
    result = _alembic(url, *args)
    assert result.returncode == 0, result.stderr[-2000:]


def _version(connection):
    return connection.scalar(text("SELECT version_num FROM alembic_version"))


def _seed_base(connection):
    ids = {k: uuid.uuid4() for k in ("country", "state", "city", "type", "user", "env_a", "env_b", "env_c", "env_d", "device")}
    connection.execute(text("INSERT INTO locationcountry (id, name, is_active) VALUES (:i, 'Pais', true)"), {"i": ids["country"]})
    connection.execute(text("INSERT INTO locationstate (id, name, country_id, is_active) VALUES (:i, 'Prov', :c, true)"), {"i": ids["state"], "c": ids["country"]})
    connection.execute(text("INSERT INTO locationcity (id, name, postal_code, state_id, is_active) VALUES (:i, 'Ciudad', '1', :s, true)"), {"i": ids["city"], "s": ids["state"]})
    connection.execute(text("INSERT INTO environmenttype (id, name, is_active) VALUES (:i, 'Tipo', true)"), {"i": ids["type"]})
    connection.execute(text(
        "INSERT INTO \"user\" (id, email, username, password, first_name, last_name, created_at, is_active, is_admin, must_change_password, is_social_auth) "
        "VALUES (:i, 'a@example.com', 'a', 'x', 'a', 'b', now(), true, false, false, false)"), {"i": ids["user"]})
    for key, location in (
        ("env_a", "-31.4167,-64.1833"),
        ("env_b", "https://www.google.com/maps/@-34.6037,-58.3816,15z"),
        ("env_c", "Sin coordenadas"),
        ("env_d", "95.5,10.5"),
    ):
        connection.execute(text(
            "INSERT INTO environment (id, name, address, location, description, city_id, type_id, is_active, is_public_map_visible) "
            "VALUES (:i, :n, 'addr', :l, 'd', :c, :t, true, false)"),
            {"i": ids[key], "n": key, "l": location, "c": ids["city"], "t": ids["type"]})
    return ids


def test_upgrade_handles_existing_violations_and_round_trips(scratch_url):
    _must(scratch_url, "upgrade", "0014")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        ids = _seed_base(connection)
        # Three active memberships for the same pair: a plain member, the owner, another member.
        member_ids = [uuid.uuid4() for _ in range(3)]
        for member_id, owner in zip(member_ids, (False, True, False)):
            connection.execute(text(
                "INSERT INTO environmentuser (id, environment_id, user_id, is_owner, is_active) VALUES (:i, :e, :u, :o, true)"),
                {"i": member_id, "e": ids["env_a"], "u": ids["user"], "o": owner})
        device_type = connection.scalar(text("SELECT id FROM device_type LIMIT 1"))
        connection.execute(text(
            "INSERT INTO device (id, serial, name, status, is_active, enabled, broker_connected, device_type_id) "
            "VALUES (:i, 'IOT-ABCD-EFGH', 'd', 'PAIRED', true, true, false, :t)"), {"i": ids["device"], "t": device_type})
        for serial in ("IOT-ABCD-EFGH", "iotabcdefgh", "IOT-NOPE-0000"):
            connection.execute(text(
                "INSERT INTO deviceoperation (id, device_serial, operation_type, status) VALUES (:i, :s, 'KEEP_ACTIVE', 'SUCCESS')"),
                {"i": uuid.uuid4(), "s": serial})
    engine.dispose()

    _must(scratch_url, "upgrade", "head")

    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        assert _version(connection) == "0017"
        # 1) device_id backfilled by canonical serial; the orphan stays NULL.
        rows = dict(connection.execute(text("SELECT device_serial, device_id FROM deviceoperation")).all())
        assert rows["IOT-ABCD-EFGH"] == ids["device"]
        assert rows["iotabcdefgh"] == ids["device"]
        assert rows["IOT-NOPE-0000"] is None
        # 2) exactly one active membership survives and it is the owner; extras are deactivated, not deleted.
        active = connection.execute(text("SELECT id FROM environmentuser WHERE is_active")).scalars().all()
        assert active == [member_ids[1]]
        assert connection.scalar(text("SELECT count(*) FROM environmentuser")) == 3
        # 3) coordinates parsed; free text and out-of-range pairs stay NULL; location untouched.
        coords = {row[0]: row[1:] for row in connection.execute(text("SELECT name, latitude, longitude, location FROM environment")).all()}
        assert coords["env_a"][:2] == (-31.4167, -64.1833)
        assert coords["env_b"][:2] == (-34.6037, -58.3816)
        assert coords["env_c"][:2] == (None, None)
        assert coords["env_d"][:2] == (None, None)
        assert coords["env_c"][2] == "Sin coordenadas"
    engine.dispose()

    _must(scratch_url, "downgrade", "0014")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        assert _version(connection) == "0014"
        columns = connection.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name IN ('environment', 'deviceoperation')")).scalars().all()
        assert "latitude" not in columns and "device_id" not in columns
        assert connection.scalar(text("SELECT count(*) FROM environment WHERE location = ''")) == 0
    engine.dispose()

    _must(scratch_url, "upgrade", "head")


def test_upgrade_refuses_to_guess_when_catalog_duplicates_exist(scratch_url):
    _must(scratch_url, "upgrade", "0014")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        for name in ("Peru", "peru"):
            connection.execute(text("INSERT INTO locationcountry (id, name, is_active) VALUES (:i, :n, true)"),
                               {"i": uuid.uuid4(), "n": name})
    engine.dispose()

    result = _alembic(scratch_url, "upgrade", "head")

    assert result.returncode != 0
    assert "duplicate catalog names" in result.stderr
    assert "locationcountry lower(name)" in result.stderr
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        # Nothing half-applied: the failed run rolled back.
        assert _version(connection) == "0014"
        assert connection.scalar(text(
            "SELECT count(*) FROM information_schema.columns WHERE table_name = 'deviceoperation' AND column_name = 'device_id'")) == 0
    engine.dispose()
