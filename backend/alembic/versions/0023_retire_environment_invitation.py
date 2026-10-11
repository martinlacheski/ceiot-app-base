"""retire the legacy environmentinvitation table

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-11

Normalization item 7: environment invitations lived in two tables. The legacy
``environmentinvitation`` (Spanish varchar status, no access start, environment only) was
only reachable through ``/api/environment/{id}/invitations`` (no frontend caller) and as a
fallback of ``/api/access/invitations/{id}``; ``scoped_guest_invitation`` covers both scopes.

upgrade():

* Every legacy row is copied into ``scoped_guest_invitation`` with the **same id**, so the
  ``/invitations/accept?id=<id>`` links already sent by email keep resolving through the
  scoped routes. ``scope_type`` = environment, ``scope_id`` = ``environment_id``,
  ``owner_user_id`` = ``owner_id``, ``access_starts_at`` = ``created_at`` (the legacy flow
  granted access immediately on acceptance), status mapped Pendiente/Aceptada/Rechazada/
  Revocada -> pending/accepted/declined/revoked; email, ``is_active`` and the three
  timestamps are copied as they are. A row whose id already exists in
  ``scoped_guest_invitation`` is skipped (the scoped row wins). An unknown legacy status
  aborts the migration instead of guessing.
* The ``environmentinvitation_owner_access`` RLS policy and the table are dropped.
* ``invitation:read``, ``invitation:create`` and ``invitation:delete`` (they only gated the
  removed legacy routes) are removed from every user's ``permissions`` JSON.

The copy runs as ``system_admin`` (transaction-local ``app.current_user_id``) because both
tables FORCE row level security and a non-superuser migration role would otherwise insert
nothing; the previous value is restored afterwards.

downgrade() is a best-effort reconstruction (no tracking table is kept):

* The table, its RLS flags and policy are recreated as 0001 defined them, with the
  ``timestamptz`` columns 0022 gave it.
* Every **environment-scoped** ``scoped_guest_invitation`` whose environment still exists
  is copied back with the reverse status mapping. That is a superset of the original legacy
  rows (invitations created through the scoped routes are copied too), and rows are kept in
  ``scoped_guest_invitation`` as well: the downgraded access router looks there first, so
  every email link keeps resolving to one record, and a later upgrade skips them by id.
  Legacy rows skipped on upgrade because of an id clash are not recoverable.
* The three permission codes are re-granted to every user holding ``environment:read``
  (they were part of ``BASIC_PERMISSIONS`` together); individual grants outside that set are
  not restored.
"""
from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Fixed values copied here on purpose: the modules that defined them are deleted by this
# same change, and a migration must not depend on application constants.
INVITATION_CODES = ("invitation:create", "invitation:delete", "invitation:read")
REGRANT_SIGNAL = "environment:read"
STATUS_MAP = (
    ("Pendiente", "pending"),
    ("Aceptada", "accepted"),
    ("Rechazada", "declined"),
    ("Revocada", "revoked"),
)

UID = "current_setting('app.current_user_id', true)"
SYSTEM = f"{UID} = ANY (ARRAY['system_mqtt', 'system_admin'])"

user_table = sa.table(
    "user",
    sa.column("id", sa.Uuid()),
    sa.column("permissions", sa.JSON()),
)


def _case(column: str, pairs) -> str:
    whens = " ".join(f"WHEN '{source}' THEN '{target}'" for source, target in pairs)
    return f"CASE {column} {whens} END"


def _as_system_admin(bind) -> str | None:
    previous = bind.scalar(sa.text(f"SELECT {UID}"))
    bind.execute(sa.text("SELECT set_config('app.current_user_id', 'system_admin', true)"))
    return previous


def _restore_identity(bind, previous: str | None) -> None:
    bind.execute(
        sa.text("SELECT set_config('app.current_user_id', :v, true)"),
        {"v": previous or ""},
    )


def upgrade() -> None:
    bind = op.get_bind()
    previous = _as_system_admin(bind)

    known = [source for source, _ in STATUS_MAP]
    unknown = bind.execute(
        sa.text("SELECT DISTINCT status FROM environmentinvitation WHERE NOT (status = ANY(:k))"),
        {"k": known},
    ).scalars().all()
    if unknown:
        raise RuntimeError(f"environmentinvitation has unmapped statuses: {sorted(unknown)}")

    bind.execute(sa.text(f"""
        INSERT INTO scoped_guest_invitation (
            id, owner_user_id, email, scope_type, scope_id, access_starts_at,
            status, is_active, created_at, updated_at, processed_at
        )
        SELECT ei.id, ei.owner_id, ei.email, 'environment', ei.environment_id, ei.created_at,
               ({_case('ei.status', STATUS_MAP)})::invitationstatus,
               ei.is_active, ei.created_at, ei.updated_at, ei.processed_at
        FROM environmentinvitation ei
        WHERE NOT EXISTS (SELECT 1 FROM scoped_guest_invitation s WHERE s.id = ei.id)
    """))

    _restore_identity(bind, previous)

    op.execute("DROP POLICY IF EXISTS environmentinvitation_owner_access ON environmentinvitation")
    op.drop_table("environmentinvitation")

    codes = set(INVITATION_CODES)
    rows = bind.execute(sa.select(user_table.c.id, user_table.c.permissions)).all()
    for user_id, permissions in rows:
        current = set(permissions or [])
        if current & codes:
            bind.execute(
                user_table.update()
                .where(user_table.c.id == user_id)
                .values(permissions=sorted(current - codes))
            )


def downgrade() -> None:
    """Best-effort reconstruction: see module docstring."""
    bind = op.get_bind()

    op.create_table(
        "environmentinvitation",
        sa.Column("email", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("status", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("environment_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["environment_id"], ["environment.id"]),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute('ALTER TABLE "environmentinvitation" ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE "environmentinvitation" FORCE ROW LEVEL SECURITY')
    op.execute(f"""
        CREATE POLICY environmentinvitation_owner_access ON environmentinvitation FOR ALL TO PUBLIC
        USING ({SYSTEM} OR owner_id::text = {UID})
        WITH CHECK ({SYSTEM} OR owner_id::text = {UID})
    """)

    previous = _as_system_admin(bind)
    reverse = [(target, source) for source, target in STATUS_MAP]
    bind.execute(sa.text(f"""
        INSERT INTO environmentinvitation (
            id, email, status, environment_id, owner_id, is_active,
            created_at, updated_at, processed_at
        )
        SELECT s.id, s.email, {_case('s.status::text', reverse)}, s.scope_id, s.owner_user_id,
               s.is_active, s.created_at, s.updated_at, s.processed_at
        FROM scoped_guest_invitation s
        JOIN environment e ON e.id = s.scope_id
        WHERE s.scope_type = 'environment'
    """))
    _restore_identity(bind, previous)

    codes = set(INVITATION_CODES)
    rows = bind.execute(sa.select(user_table.c.id, user_table.c.permissions)).all()
    for user_id, permissions in rows:
        current = set(permissions or [])
        if REGRANT_SIGNAL in current and not codes <= current:
            bind.execute(
                user_table.update()
                .where(user_table.c.id == user_id)
                .values(permissions=sorted(current | codes))
            )
