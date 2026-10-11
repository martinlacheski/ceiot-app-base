"""Migration 0023: the legacy ``environmentinvitation`` table is retired (normalization item 7).

A throwaway ``<dev_db>_n7mig`` database is migrated to 0022 and seeded with one legacy
invitation per status, one legacy row whose id already exists as a scoped invitation and a
user holding the ``invitation:*`` permission codes. It is upgraded, downgraded and upgraded
again. It never touches the dev or the shared test database.
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

CREATED = "2026-09-01 12:00:00+00"
PROCESSED = "2026-09-02 08:30:00+00"
LEGACY_STATUSES = {
    "Pendiente": "pending",
    "Aceptada": "accepted",
    "Rechazada": "declined",
    "Revocada": "revoked",
}
INVITATION_CODES = {"invitation:read", "invitation:create", "invitation:delete"}
KEPT_CODES = {"environment:read", "access:read", "device:read"}


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


def _seed(connection, ids):
    suffix = uuid.uuid4().hex[:8]
    connection.execute(text(
        'INSERT INTO "user" (id, email, username, password, first_name, last_name, permissions, '
        "created_at, is_active, is_admin, must_change_password, is_social_auth) "
        "VALUES (:i, :e, :e, 'x', 'N', 'N', CAST(:p AS json), now(), true, false, false, false)"
    ), {
        "i": ids["owner"],
        "e": f"owner-{suffix}@example.com",
        "p": '["' + '", "'.join(sorted(INVITATION_CODES | KEPT_CODES)) + '"]',
    })
    connection.execute(text(
        "INSERT INTO locationcountry (id, name, is_active) VALUES (:i, :n, true)"
    ), {"i": ids["country"], "n": f"Pais {suffix}"})
    connection.execute(text(
        "INSERT INTO locationstate (id, name, country_id, is_active) VALUES (:i, :n, :c, true)"
    ), {"i": ids["state"], "n": f"Provincia {suffix}", "c": ids["country"]})
    connection.execute(text(
        "INSERT INTO locationcity (id, name, postal_code, state_id, is_active) "
        "VALUES (:i, :n, '5500', :s, true)"
    ), {"i": ids["city"], "n": f"Ciudad {suffix}", "s": ids["state"]})
    connection.execute(text(
        "INSERT INTO environmenttype (id, name, is_active) VALUES (:i, :n, true)"
    ), {"i": ids["type"], "n": f"Tipo {suffix}"})
    connection.execute(text(
        "INSERT INTO environment (id, name, address, location, description, city_id, type_id, "
        "is_active, is_public_map_visible) "
        "VALUES (:i, 'Legacy Env', 'Street 1', 'Patio', 'Env', :c, :t, true, false)"
    ), {"i": ids["environment"], "c": ids["city"], "t": ids["type"]})
    for status in LEGACY_STATUSES:
        connection.execute(text(
            "INSERT INTO environmentinvitation (id, email, status, environment_id, owner_id, "
            "is_active, created_at, updated_at, processed_at) "
            "VALUES (:i, :e, :s, :env, :o, :a, :c, :c, :p)"
        ), {
            "i": ids[status],
            "e": f"{status.lower()}@example.com",
            "s": status,
            "env": ids["environment"],
            "o": ids["owner"],
            "a": status in {"Pendiente", "Aceptada"},
            "c": CREATED,
            "p": None if status == "Pendiente" else PROCESSED,
        })
    # A legacy row whose id is already a scoped invitation must not overwrite it.
    connection.execute(text(
        "INSERT INTO environmentinvitation (id, email, status, environment_id, owner_id, is_active, created_at) "
        "VALUES (:i, 'clash-legacy@example.com', 'Pendiente', :env, :o, true, :c)"
    ), {"i": ids["clash"], "env": ids["environment"], "o": ids["owner"], "c": CREATED})
    connection.execute(text(
        "INSERT INTO scoped_guest_invitation (id, owner_user_id, email, scope_type, scope_id, "
        "access_starts_at, status, is_active, created_at) "
        "VALUES (:i, :o, 'clash-scoped@example.com', 'environment', :env, :c, 'accepted', true, :c)"
    ), {"i": ids["clash"], "o": ids["owner"], "env": ids["environment"], "c": CREATED})


def _table_exists(connection, name):
    return connection.scalar(text("SELECT to_regclass(:n) IS NOT NULL"), {"n": f"public.{name}"})


def _policies(connection, table):
    return set(connection.execute(text(
        "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = :t"
    ), {"t": table}).scalars())


def _permissions(connection, user_id):
    return set(connection.scalar(text('SELECT permissions FROM "user" WHERE id = :i'), {"i": user_id}))


def _assert_retired(connection, ids):
    assert not _table_exists(connection, "environmentinvitation")
    rows = {
        row.id: row
        for row in connection.execute(text(
            "SELECT id, owner_user_id, email, scope_type::text AS scope_type, scope_id, "
            "access_starts_at, status::text AS status, is_active, created_at, updated_at, processed_at "
            "FROM scoped_guest_invitation"
        ))
    }
    for legacy, scoped in LEGACY_STATUSES.items():
        row = rows[ids[legacy]]
        assert row.status == scoped, legacy
        assert row.scope_type == "environment"
        assert row.scope_id == ids["environment"]
        assert row.owner_user_id == ids["owner"]
        assert row.email == f"{legacy.lower()}@example.com"
        assert row.is_active is (legacy in {"Pendiente", "Aceptada"})
        assert row.access_starts_at == row.created_at
        assert row.updated_at == row.created_at
        assert (row.processed_at is None) is (legacy == "Pendiente")
    clash = rows[ids["clash"]]
    assert (clash.email, clash.status) == ("clash-scoped@example.com", "accepted")
    assert len(rows) == len(LEGACY_STATUSES) + 1
    assert _permissions(connection, ids["owner"]) == KEPT_CODES


def test_upgrade_moves_legacy_invitations_strips_permissions_and_round_trips(scratch_url):
    ids = {key: uuid.uuid4() for key in (
        "owner", "country", "state", "city", "type", "environment", "clash", *LEGACY_STATUSES,
    )}
    _must(scratch_url, "upgrade", "0022")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        _seed(connection, ids)
        assert _policies(connection, "environmentinvitation") == {"environmentinvitation_owner_access"}
    engine.dispose()

    _must(scratch_url, "upgrade", "0023")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        _assert_retired(connection, ids)
    engine.dispose()

    _must(scratch_url, "downgrade", "0022")
    engine = create_engine(scratch_url)
    with engine.begin() as connection:
        assert _table_exists(connection, "environmentinvitation")
        assert _policies(connection, "environmentinvitation") == {"environmentinvitation_owner_access"}
        assert connection.scalar(text(
            "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class "
            "WHERE oid = 'public.environmentinvitation'::regclass"
        ))
        restored = {
            row.id: row.status
            for row in connection.execute(text("SELECT id, status FROM environmentinvitation"))
        }
        for legacy in LEGACY_STATUSES:
            assert restored[ids[legacy]] == legacy
        # Environment-scoped invitations stay in scoped_guest_invitation too (same id), so the
        # downgraded access router, which looks there first, keeps resolving every email link.
        assert connection.scalar(text(
            "SELECT count(*) FROM scoped_guest_invitation WHERE id = ANY(:i)"
        ), {"i": [ids[legacy] for legacy in LEGACY_STATUSES]}) == len(LEGACY_STATUSES)
        assert INVITATION_CODES <= _permissions(connection, ids["owner"])
    engine.dispose()

    _must(scratch_url, "upgrade", "head")
    engine = create_engine(scratch_url)
    with engine.connect() as connection:
        _assert_retired(connection, ids)
    engine.dispose()
