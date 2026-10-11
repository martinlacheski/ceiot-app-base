"""Migration 0026: grants the dedicated ``environment_type:*`` permission codes.

A throwaway ``<dev_db>_n7mig`` database is migrated to 0025 and seeded with an admin, an
admin that already holds some codes, a standard user and a standard user that already
holds ``environment_type:read``. It is upgraded, downgraded and upgraded again. It never
touches the dev or the shared test database.
"""

import json
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
READ = "environment_type:read"
MANAGE = {"environment_type:create", "environment_type:update", "environment_type:delete"}

# username -> (is_admin, permissions before 0026)
USERS = {
    "n7_admin": (True, ["user:me", "environment:create"]),
    "n7_admin_partial": (True, ["user:me", READ, "environment_type:create"]),
    "n7_standard": (False, ["user:me", "environment:create"]),
    "n7_standard_read": (False, ["user:me", READ]),
    "n7_standard_null": (False, None),
}


@pytest.fixture
def scratch_url():
    dev_url = make_url(settings.DATABASE_URL)
    if dev_url.get_backend_name() != "postgresql":
        pytest.skip("requires PostgreSQL")
    dev_sync = dev_url.set(drivername="postgresql+psycopg")
    name = f"{dev_url.database}_n7mig"
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
        connection.exec_driver_sql(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %(n)s AND pid <> pg_backend_pid()",
            {"n": name},
        )
        connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
    maintenance.dispose()


def _must(url, *args):
    env = dict(os.environ, ALEMBIC_DATABASE_URL=url.render_as_string(hide_password=False))
    result = subprocess.run(["alembic", *args], cwd=str(BACKEND_ROOT), env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr[-2000:]


def _permissions(url) -> dict[str, list[str] | None]:
    engine = create_engine(url)
    with engine.connect() as connection:
        rows = connection.execute(text(
            "SELECT username, permissions FROM \"user\" WHERE username LIKE 'n7_%'"
        )).all()
    engine.dispose()
    return {username: permissions for username, permissions in rows}


def _codes(value) -> set[str]:
    return set(value or [])


def test_upgrade_grants_management_codes_to_admins_only(scratch_url):
    _must(scratch_url, "upgrade", "0025")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        for username, (is_admin, permissions) in USERS.items():
            connection.execute(text(
                'INSERT INTO "user" (id, email, username, password, first_name, last_name, created_at, '
                "is_active, is_verified, is_admin, must_change_password, is_social_auth, permissions) "
                "VALUES (:i, :e, :u, 'x', 'N7', 'User', now(), true, true, :a, false, false, CAST(:p AS json))"
            ), {"i": uuid.uuid4(), "e": f"{username}@example.com", "u": username, "a": is_admin,
                "p": None if permissions is None else json.dumps(permissions)})
    engine.dispose()

    _must(scratch_url, "upgrade", "0026")
    upgraded = _permissions(scratch_url)
    for username in ("n7_admin", "n7_admin_partial"):
        codes = upgraded[username]
        assert {READ, *MANAGE} <= set(codes)
        assert len(codes) == len(set(codes)), "no duplicated codes"
        assert "user:me" in codes
    for username in ("n7_standard", "n7_standard_read", "n7_standard_null"):
        codes = upgraded[username]
        assert READ in codes
        assert MANAGE.isdisjoint(codes)
        assert len(codes) == len(set(codes))
    assert "environment:create" in upgraded["n7_standard"]

    _must(scratch_url, "downgrade", "0025")
    downgraded = _permissions(scratch_url)
    for username in USERS:
        assert MANAGE.isdisjoint(_codes(downgraded[username]))
        assert READ in _codes(downgraded[username]), "downgrade leaves read in place"
    assert "user:me" in downgraded["n7_admin"]

    _must(scratch_url, "upgrade", "head")
    reupgraded = _permissions(scratch_url)
    assert {READ, *MANAGE} <= set(reupgraded["n7_admin"])
    assert MANAGE.isdisjoint(reupgraded["n7_standard"])
