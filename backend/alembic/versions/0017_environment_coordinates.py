"""environment.latitude / longitude (double precision) replace the "lat,lng" string

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-02

``environment.location`` held coordinates as text (sometimes a Google Maps URL). The
typed ``latitude``/``longitude`` columns become the source of truth, with a CHECK that
both are set or both NULL and inside the valid ranges.

Backfill: same pattern as ``app.core.coordinates.parse_lat_lng`` (the first
``lat, lng`` pair in the text, which also covers ``@lat,lng`` and ``?q=lat,lng`` URLs);
pairs out of range and free text leave both columns NULL. Nothing is lost: ``location``
is NOT dropped here.

Decision: ``location`` stays for now as a deprecated, application-synchronised mirror
(an ORM hook on Environment keeps it equal to the numeric pair). Dropping it right away
would break the API contract, the device "effective location", the environment search and
the frontend in one step; it should be dropped in a later migration once those readers
use latitude/longitude. The ai_read views never exposed it (intentionally) and are
untouched; RLS policies do not reference it.

RLS is disabled only inside this transaction for the data steps (no UPDATE policy for the
migration role's session identity).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017"
down_revision: Union[str, Sequence[str], None] = "0016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHECK_NAME = "ck_environment_coordinates_valid"
CHECK_SQL = (
    "(latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL "
    "AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)"
)


def upgrade() -> None:
    op.add_column("environment", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("environment", sa.Column("longitude", sa.Float(), nullable=True))

    op.execute("ALTER TABLE public.environment DISABLE ROW LEVEL SECURITY")
    op.execute(r"""
        UPDATE public.environment AS e
        SET latitude = parsed.pair[1]::double precision,
            longitude = parsed.pair[2]::double precision
        FROM (
            SELECT id,
                   regexp_match(location, '([-+]?\d{1,2}\.\d+),\s*([-+]?\d{1,3}\.\d+)') AS pair
            FROM public.environment
        ) AS parsed
        WHERE e.id = parsed.id
          AND parsed.pair IS NOT NULL
          AND parsed.pair[1]::double precision BETWEEN -90 AND 90
          AND parsed.pair[2]::double precision BETWEEN -180 AND 180
    """)
    op.execute("ALTER TABLE public.environment ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.environment FORCE ROW LEVEL SECURITY")

    op.create_check_constraint(CHECK_NAME, "environment", CHECK_SQL)


def downgrade() -> None:
    # Rows written after the upgrade through numeric coordinates only still have their
    # mirror in `location` (ORM hook); make sure none is empty before the columns go.
    op.execute("ALTER TABLE public.environment DISABLE ROW LEVEL SECURITY")
    op.execute("""
        UPDATE public.environment
        SET location = latitude::text || ',' || longitude::text
        WHERE (location IS NULL OR location = '')
          AND latitude IS NOT NULL AND longitude IS NOT NULL
    """)
    op.execute("ALTER TABLE public.environment ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.environment FORCE ROW LEVEL SECURITY")

    op.drop_constraint(CHECK_NAME, "environment", type_="check")
    op.drop_column("environment", "longitude")
    op.drop_column("environment", "latitude")
