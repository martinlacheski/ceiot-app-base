"""Helpers for tests that read the hourly telemetry rollup (continuous aggregate).

The refresh policy only materializes the last three days, and once it has run, rows older than
its watermark are read from the materialization only: tests that seed past telemetry refresh
the window explicitly, like an operator does after a backfill (docs/ciclo-de-vida-datos.md).
``refresh_continuous_aggregate`` cannot run inside a transaction block: AUTOCOMMIT.
"""

from datetime import datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

CAGG = "telemetry_store.telemetry_hourly"


async def refresh_hourly(admin_url: str, start: datetime, end: datetime) -> None:
    engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as connection:
            # CALL takes no bind parameters; the bounds are test-controlled datetimes.
            await connection.execute(text(
                f"CALL refresh_continuous_aggregate('{CAGG}', "
                f"'{start.isoformat()}'::timestamptz, '{end.isoformat()}'::timestamptz)"
            ))
    finally:
        await engine.dispose()
