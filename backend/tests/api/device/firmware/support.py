"""Shared helpers for the firmware (OTA) tests."""

import hashlib
import json
import struct
from contextlib import asynccontextmanager

from fastapi.testclient import TestClient
from sqlmodel import Session, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.firmware.models import FirmwareRelease, FirmwareUpdate
from app.api.device.models import Device
from app.api.device.operations.models import DeviceOperation
from app.api.device.service import DeviceService
from app.core.security import create_access_token

URL = "/api/firmware"
PROJECT = "iot_device"
VERSION = "1.2.0"
DOWNLOAD_BASE = "http://192.168.1.50:18000"


def auth(user) -> dict:
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


def esp_image(
    size: int = 4096,
    first_byte: int = 0xE9,
    *,
    version: str = VERSION,
    project: str = PROJECT,
    build_time: str = "14:32:05",
    build_date: str = "Oct  6 2026",
    idf: str = "v5.3",
    magic: int = 0xABCD5432,
) -> bytes:
    """A fake ESP app image: image header, first segment header and a real `esp_app_desc_t` at
    offset 32 (magic word, version@48, project@80, time@112, date@128, idf@144), then filler."""

    def text(value: str, width: int) -> bytes:
        return value.encode().ljust(width, b"\0")

    descriptor = (
        struct.pack("<IIII", magic, 0, 0, 0)
        + text(version, 32)
        + text(project, 32)
        + text(build_time, 16)
        + text(build_date, 16)
        + text(idf, 32)
    )
    body = bytes([first_byte]) + bytes(31) + descriptor
    filler = bytes((i * 7) % 251 for i in range(max(size - len(body), 0)))
    return (body + filler)[: max(size, len(body))]


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def upload(client: TestClient, user, *, data: bytes | None = None, version: str = VERSION, **fields):
    """Upload through the API; the image carries `version` unless `data` is given."""
    body = {"notes": "first"}
    body.update(fields)
    if data is None:
        data = esp_image(version=version)
    return client.post(
        f"{URL}/releases",
        headers=auth(user),
        data={key: value for key, value in body.items() if value is not None},
        files={"file": ("iot_device.bin", data, "application/octet-stream")},
    )


def seed_device(session: Session, *, online: bool = True, firmware_version: str | None = "1.1.0") -> Device:
    device = Device(
        serial=DeviceService.generate_serial(),
        name="Sensor",
        broker_connected=online,
        firmware_version=firmware_version,
    )
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


def seed_release(session: Session, version: str = VERSION, *, active: bool = True, created_at=None) -> FirmwareRelease:
    release = FirmwareRelease(
        version=version,
        storage_key=f"firmware/{version}.bin",
        sha256="a" * 64,
        size=4096,
        active=active,
    )
    if created_at is not None:
        release.created_at = created_at
    session.add(release)
    session.commit()
    session.refresh(release)
    return release


def seed_attempt(session: Session, *, state: str = "requested", request_id: str = "req-1"):
    device = seed_device(session)
    release = seed_release(session)
    attempt = FirmwareUpdate(
        request_id=request_id,
        device_id=device.id,
        device_serial=device.serial,
        release_id=release.id,
        state=state,
        target_version=VERSION,
    )
    session.add(attempt)
    session.commit()
    session.refresh(attempt)
    return device, attempt


def ota_status(state: str, **extra) -> str:
    body = {"request_id": "req-1", "state": state, "running_version": "1.1.0", "target_version": VERSION}
    body.update(extra)
    return json.dumps(body)


def reload(session: Session, attempt: FirmwareUpdate) -> FirmwareUpdate:
    session.expire_all()
    return session.get(FirmwareUpdate, attempt.id)


def history(session: Session, serial: str) -> list[DeviceOperation]:
    session.expire_all()
    return list(session.exec(select(DeviceOperation).where(DeviceOperation.device_serial == serial)).all())


def attempts(session: Session) -> list[FirmwareUpdate]:
    session.expire_all()
    return list(session.exec(select(FirmwareUpdate)).all())


def fake_system_session(async_engine):
    @asynccontextmanager
    async def _session():
        async with AsyncSession(async_engine, expire_on_commit=False) as session:
            yield session

    return _session
