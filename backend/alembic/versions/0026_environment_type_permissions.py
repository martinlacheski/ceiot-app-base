"""grant the dedicated environment_type permission codes

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-11

Environment types are a global catalog. Their router used to check the establishment codes
(``environment:create|read|update|delete``), which every standard user holds through
``BASIC_PERMISSIONS``, so any standard user could create, edit or delete catalog entries.
The router now checks ``environment_type:read|create|update|delete`` (the Document Types
pattern); ``environment_type:read`` stays basic and the other three are admin-only.

Permission codes are stored per user (``PermissionChecker`` has no ``is_admin`` bypass), so
existing accounts need a backfill:
  - Admins (``is_admin``) get all four codes.
  - Everyone else gets ``environment_type:read`` when missing (the list endpoint now
    requires it).

Purely a data update on ``"user".permissions`` (a JSON array), in the style of 0006.
``"user"`` has no Row Level Security (see 0010), so no ``system_admin`` identity is needed.
Idempotent in both directions. downgrade() removes the three management codes from every
user and leaves ``environment_type:read`` in place: it was already part of
``BASIC_PERMISSIONS`` before this revision, so it cannot be told apart from a prior grant.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: str | Sequence[str] | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Fixed values copied here on purpose: a migration must not change if the permission
# constants in app.core.permissions change.
READ = "environment_type:read"
MANAGE = {"environment_type:create", "environment_type:update", "environment_type:delete"}

user_table = sa.table(
    "user",
    sa.column("id", sa.Uuid()),
    sa.column("is_admin", sa.Boolean()),
    sa.column("permissions", sa.JSON()),
)


def _with_additions(permissions: list[str] | None, additions: set[str]) -> list[str] | None:
    """Append the missing codes keeping the existing order; None when nothing changes."""
    current = list(dict.fromkeys(permissions or []))
    missing = sorted(additions - set(current))
    return current + missing if missing else None


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(user_table.c.id, user_table.c.is_admin, user_table.c.permissions)
    ).all()
    for user_id, is_admin, permissions in rows:
        updated = _with_additions(permissions, {READ, *MANAGE} if is_admin else {READ})
        if updated is not None:
            bind.execute(
                user_table.update().where(user_table.c.id == user_id).values(permissions=updated)
            )


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.select(user_table.c.id, user_table.c.permissions)).all()
    for user_id, permissions in rows:
        current = permissions or []
        if MANAGE & set(current):
            bind.execute(
                user_table.update()
                .where(user_table.c.id == user_id)
                .values(permissions=[code for code in current if code not in MANAGE])
            )
