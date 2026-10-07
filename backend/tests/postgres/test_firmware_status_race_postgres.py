"""Two concurrent `ota/status` handlers on real PostgreSQL (SQLite ignores `SELECT ... FOR UPDATE`).

The device publishes `accepted` and ~20 ms later `failed`; both handlers start from the old state.
Without the row lock the stale `accepted` could commit over `failed` and leave the attempt
"in progress" with an error. `FirmwareService.apply_status` must serialize them, and the history
record must be written exactly once. Sessions run as the NOBYPASSRLS role with the `system_mqtt`
identity, like the MQTT runtime.
"""

import asyncio
import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.firmware.models import FirmwareRelease, FirmwareUpdate
from app.api.device.firmware.service import FirmwareService
from app.api.device.models import Device
from app.api.device.service import DeviceService

pytestmark = pytest.mark.asyncio

ROUNDS = 8


@asynccontextmanager
async def _system(engine):
    """Same shape as `system_session`: one explicit connection keeps the identity across commits."""
    async with engine.connect() as connection:
        async with AsyncSession(connection, expire_on_commit=False) as session:
            await session.execute(text("SELECT set_config('app.current_user_id', 'system_mqtt', false)"))
            yield session


async def _apply(engine, serial: str, data: dict):
    async with _system(engine) as session:
        return await FirmwareService(session).apply_status(serial, data)


async def test_concurrent_accepted_and_failed_always_end_failed(postgres_rls_config, rls_engine_factory):
    admin = create_engine(postgres_rls_config.admin_url.replace("+asyncpg", "+psycopg"))
    serial = DeviceService.generate_serial()
    version = f"race-{uuid.uuid4().hex[:8]}"
    with Session(admin) as setup:
        device = Device(serial=serial, name="race")
        release = FirmwareRelease(version=version, storage_key="k", sha256="a" * 64, size=4096)
        setup.add_all([device, release])
        setup.commit()
        device_id, release_id = device.id, release.id

    role_engine = rls_engine_factory(pool_size=2)
    try:
        for round_no in range(ROUNDS):
            request_id = f"req-race-{uuid.uuid4().hex[:8]}-{round_no}"
            with Session(admin) as setup:
                setup.add(
                    FirmwareUpdate(
                        request_id=request_id,
                        device_id=device_id,
                        device_serial=serial,
                        release_id=release_id,
                        state="requested",
                        target_version=version,
                    )
                )
                setup.commit()
            accepted = {"request_id": request_id, "state": "accepted"}
            failed = {"request_id": request_id, "state": "failed", "error": {"code": "internal", "message": "boom"}}

            await asyncio.gather(_apply(role_engine, serial, accepted), _apply(role_engine, serial, failed))

            with Session(admin) as check:
                row = check.exec(select(FirmwareUpdate).where(FirmwareUpdate.request_id == request_id)).one()
                assert (row.state, row.error_code) == ("failed", "internal"), f"round {round_no}"
                operations = check.execute(
                    text("SELECT count(*) FROM deviceoperation WHERE id = :id AND operation_type = 'FIRMWARE_UPDATE'"),
                    {"id": row.operation_id},
                ).scalar_one()
                assert operations == 1, f"round {round_no}"
    finally:
        with admin.begin() as cleanup:
            cleanup.execute(text("DELETE FROM deviceoperation WHERE device_serial = :s"), {"s": serial})
            cleanup.execute(text("DELETE FROM firmware_update WHERE device_serial = :s"), {"s": serial})
            cleanup.execute(text("DELETE FROM firmware_release WHERE id = :id"), {"id": release_id})
            cleanup.execute(text("DELETE FROM device WHERE id = :id"), {"id": device_id})
        admin.dispose()
