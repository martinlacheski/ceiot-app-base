"""Grant existing administrators sensor catalog write access.

Revision ID: 0007
Revises: 0006
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CODE = "sensor_catalog:write"
user_table = sa.table("user", sa.column("id", sa.Uuid()),
                      sa.column("is_admin", sa.Boolean()),
                      sa.column("permissions", sa.JSON()))


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.select(user_table.c.id, user_table.c.permissions)
                        .where(user_table.c.is_admin.is_(True))).all()
    for user_id, permissions in rows:
        current = set(permissions or [])
        if CODE not in current:
            bind.execute(user_table.update().where(user_table.c.id == user_id)
                         .values(permissions=sorted(current | {CODE})))


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.select(user_table.c.id, user_table.c.permissions)).all()
    for user_id, permissions in rows:
        current = set(permissions or [])
        if CODE in current:
            bind.execute(user_table.update().where(user_table.c.id == user_id)
                         .values(permissions=sorted(current - {CODE})))
