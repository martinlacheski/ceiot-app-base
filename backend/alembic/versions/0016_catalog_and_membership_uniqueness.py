"""Uniqueness: active membership per (environment, user) and case-insensitive catalog names

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-02

New constraints
- ``environmentuser (environment_id, user_id)`` unique WHERE is_active (inactive history
  rows may repeat, so re-inviting a former member stays possible).
- ``environmenttype lower(name)``, ``locationcountry lower(name)``,
  ``locationstate (country_id, lower(name))``, ``locationcity (state_id, lower(name))``.

Why case-insensitive: the services already compared ``lower(name)`` before creating, so
"Argentina" and "ARGENTINA" were already treated as the same entity; the index makes the
database the authority (races, paths without a pre-check). Accents and whitespace are
not folded on purpose (that would need unaccent and would surprise admins).

Existing violations, handled deterministically
- environmentuser duplicates among ACTIVE rows: one row stays active (owner first, then
  the one never updated / oldest update, then lowest id); the extras are DEACTIVATED, not
  deleted, so nothing is lost. This is not reversible by the downgrade.
- catalog duplicates: they are referenced by foreign keys (cities, environments,
  addresses), so merging is a business decision. The migration aborts with the list of
  conflicting names instead of guessing.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0016"
down_revision: Union[str, Sequence[str], None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CATALOG_CHECKS = (
    ("environmenttype", "environmenttype lower(name)", "SELECT lower(name) AS name, count(*) AS n FROM environmenttype GROUP BY 1 HAVING count(*) > 1"),
    ("locationcountry", "locationcountry lower(name)", "SELECT lower(name) AS name, count(*) AS n FROM locationcountry GROUP BY 1 HAVING count(*) > 1"),
    ("locationstate", "locationstate (country_id, lower(name))", "SELECT country_id::text || ' / ' || lower(name) AS name, count(*) AS n FROM locationstate GROUP BY country_id, lower(name) HAVING count(*) > 1"),
    ("locationcity", "locationcity (state_id, lower(name))", "SELECT state_id::text || ' / ' || lower(name) AS name, count(*) AS n FROM locationcity GROUP BY state_id, lower(name) HAVING count(*) > 1"),
)


def _assert_no_catalog_duplicates() -> None:
    bind = op.get_bind()
    problems: list[str] = []
    for _table, label, query in _CATALOG_CHECKS:
        for name, count in bind.execute(sa.text(query)):
            problems.append(f"  - {label}: {name!r} appears {count} times")
    if problems:
        raise RuntimeError(
            "Cannot add the case-insensitive uniqueness constraints: duplicate catalog names "
            "exist. They are referenced by other rows, so merge or rename them first "
            "(then re-run the migration):\n" + "\n".join(problems)
        )


def upgrade() -> None:
    _assert_no_catalog_duplicates()

    # Keep one active row per (environment, user); deactivate (never delete) the rest.
    # RLS is disabled only inside this transaction: the baseline has no UPDATE policy here.
    op.execute("ALTER TABLE public.environmentuser DISABLE ROW LEVEL SECURITY")
    op.execute("""
        UPDATE public.environmentuser
        SET is_active = false
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       row_number() OVER (
                           PARTITION BY environment_id, user_id
                           ORDER BY is_owner DESC, updated_at ASC NULLS FIRST, id
                       ) AS keep_rank
                FROM public.environmentuser
                WHERE is_active
            ) ranked
            WHERE keep_rank > 1
        )
    """)
    op.execute("ALTER TABLE public.environmentuser ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.environmentuser FORCE ROW LEVEL SECURITY")

    op.create_index(
        "uq_environmentuser_active_member",
        "environmentuser",
        ["environment_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )
    op.create_index(
        "uq_environmenttype_lower_name", "environmenttype", [sa.text("lower(name)")], unique=True
    )
    op.create_index(
        "uq_locationcountry_lower_name", "locationcountry", [sa.text("lower(name)")], unique=True
    )
    op.create_index(
        "uq_locationstate_country_lower_name",
        "locationstate",
        ["country_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_index(
        "uq_locationcity_state_lower_name",
        "locationcity",
        ["state_id", sa.text("lower(name)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_locationcity_state_lower_name", table_name="locationcity")
    op.drop_index("uq_locationstate_country_lower_name", table_name="locationstate")
    op.drop_index("uq_locationcountry_lower_name", table_name="locationcountry")
    op.drop_index("uq_environmenttype_lower_name", table_name="environmenttype")
    op.drop_index("uq_environmentuser_active_member", table_name="environmentuser")
