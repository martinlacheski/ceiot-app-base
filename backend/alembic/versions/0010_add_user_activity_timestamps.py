"""add user activity timestamps

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-24

Adds two nullable columns to `"user"`, `last_login_at` and `last_seen_at`, same
type as `created_at`/`updated_at` (naive timestamp). No backfill: `NULL` means
"no record yet" for accounts that predate this migration.

`"user"` has no Row Level Security policy in this project (see 0001: RLS is
only enabled on `environment`, `environmentuser`, `device`,
`environmentinvitation`, `scoped_guest_relation`, `scoped_guest_invitation`
and the device-data tables), so the plain, unscoped session used by
`UserRepository.touch_login` / `touch_seen` can write these columns directly.

Deployment order matters: migrate first (`alembic upgrade head`), then start
the new backend. If the new code runs before this migration, every user query
fails with `column user.last_login_at does not exist`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: Union[str, Sequence[str], None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "user",
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user", "last_seen_at")
    op.drop_column("user", "last_login_at")
