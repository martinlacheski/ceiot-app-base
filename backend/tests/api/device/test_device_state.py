"""The last-known runtime state of a device lives in ``device_state`` (1:1 with ``device``).

The MQTT runtime upserts it on every telemetry message and presence change, so those writes
never touch the ``device`` row: ``device.updated_at`` only moves on real edits (the
PAIRED -> ACTIVE transition of the first report is one). A device that never reported has no
state row; the API keeps exposing the same flat fields (NULL/False defaults).
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.models import Device, DeviceRead, DeviceState, DeviceStatus
from app.api.device.permissions import DevicePermissions
from app.api.device.repository import DeviceRepository
from app.api.device.service import DeviceService
from app.core.security import create_access_token

EDITED = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

# The flat DeviceRead contract the frontend consumes; it must not change with the table split.
DEVICE_READ_KEYS = {
    "id", "serial", "name", "description", "deviceTypeId", "model", "batch",
    "firmwareVersion", "ipAddress", "macAddress", "rssi", "wifiSsid", "lastResetReason",
    "gpsLatitude", "gpsLongitude", "gpsUpdatedAt", "effectiveLocation", "effectiveLocationSource",
    "manufactureDate", "status", "isActive", "enabled", "lastConnection", "brokerConnected",
    "brokerConnectedAt", "brokerDisconnectedAt", "brokerStatusUpdatedAt", "createdAt",
    "updatedAt", "environmentId", "type", "environment",
}


def _seed(session: Session, *, name: str = "Estado", status=DeviceStatus.ACTIVE, state=None) -> Device:
    device = Device(
        serial=DeviceService.generate_serial(), name=name, status=status, updated_at=EDITED, state=state
    )
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


async def _fresh(async_engine, device_id) -> Device:
    async with AsyncSession(async_engine, expire_on_commit=False) as fresh:
        return await fresh.get(Device, device_id)


async def _state_rows(async_engine, device_id) -> int:
    async with AsyncSession(async_engine) as fresh:
        result = await fresh.exec(
            select(func.count()).select_from(DeviceState).where(DeviceState.device_id == device_id)
        )
        return result.one()


def _headers(session: Session) -> dict[str, str]:
    from app.api.auth.models import User
    from app.core.security import hash_password

    user = User(
        email="state@example.com", username="stateadmin", password=hash_password("x"),
        is_verified=True, first_name="State", last_name="Admin", identification_number="STATE1",
        permissions=[DevicePermissions.READ, DevicePermissions.READ_ALL],
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


# --- writers ------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_runtime_report_upserts_the_state_without_touching_the_device_row(
    session: Session, async_session: AsyncSession, async_engine
):
    device = _seed(session)
    repo = DeviceRepository(async_session)
    loaded = await repo.get_by_serial(device.serial)

    await repo.register_runtime_report(
        loaded, firmware_version="1.0.0", ip_address="10.0.0.5", rssi=-60, wifi_ssid="lab",
        last_reset_reason="power_on", gps_latitude=-27.3, gps_longitude=-55.9,
    )
    assert loaded.firmware_version == "1.0.0" and loaded.last_connection is not None
    # A second report updates the same row and keeps what it does not carry.
    await repo.register_runtime_report(loaded, rssi=-70)

    fresh = await _fresh(async_engine, device.id)
    assert fresh.updated_at == EDITED
    assert fresh.status == DeviceStatus.ACTIVE
    state = fresh.state
    assert (state.firmware_version, state.ip_address, state.rssi, state.wifi_ssid, state.last_reset_reason) == (
        "1.0.0", "10.0.0.5", -70, "lab", "power_on")
    assert (state.gps_latitude, state.gps_longitude) == (-27.3, -55.9)
    assert state.gps_updated_at is not None and state.last_connection is not None
    assert state.updated_at is not None
    assert await _state_rows(async_engine, device.id) == 1


@pytest.mark.asyncio
async def test_first_report_of_a_paired_device_activates_it_and_that_bumps_updated_at(
    session: Session, async_session: AsyncSession, async_engine
):
    device = _seed(session, status=DeviceStatus.PAIRED)
    repo = DeviceRepository(async_session)

    await repo.register_runtime_report(await repo.get_by_serial(device.serial))

    fresh = await _fresh(async_engine, device.id)
    assert fresh.status == DeviceStatus.ACTIVE
    assert fresh.updated_at != EDITED  # a real lifecycle change of the device itself
    assert fresh.last_connection is not None


@pytest.mark.asyncio
async def test_broker_presence_upserts_the_state_without_touching_the_device_row(
    session: Session, async_session: AsyncSession, async_engine
):
    device = _seed(session)
    repo = DeviceRepository(async_session)

    online = await repo.update_broker_presence(device.serial, True)
    assert online.broker_connected is True and online.broker_connected_at is not None
    offline = await repo.update_broker_presence(device.serial, False)
    assert offline.broker_connected is False

    fresh = await _fresh(async_engine, device.id)
    assert fresh.updated_at == EDITED
    state = fresh.state
    assert state.broker_connected is False
    assert state.broker_connected_at is not None and state.broker_disconnected_at is not None
    assert state.broker_status_updated_at == state.broker_disconnected_at
    assert await _state_rows(async_engine, device.id) == 1
    assert await repo.update_broker_presence("IOT-UNKNOWN-0000", True) is None


def test_update_last_connection_is_gone():
    assert not hasattr(DeviceRepository, "update_last_connection")


# --- readers ------------------------------------------------------------------------------------


def test_a_device_that_never_reported_reads_empty_defaults(session: Session):
    device = _seed(session)
    assert device.state is None

    read = DeviceRead.model_validate(device)

    assert read.broker_connected is False
    assert read.firmware_version is None and read.last_connection is None
    assert read.gps_latitude is None and read.broker_status_updated_at is None


def test_list_and_detail_keep_the_flat_shape_with_state_values(client: TestClient, session: Session):
    reported = datetime(2026, 2, 3, 4, 5, 6, tzinfo=timezone.utc)
    device = _seed(session, name="Forma plana", state=DeviceState(
        firmware_version="2.0.0", ip_address="10.1.1.1", rssi=-55, wifi_ssid="red",
        last_reset_reason="watchdog", gps_latitude=-27.5, gps_longitude=-55.5, gps_updated_at=reported,
        last_connection=reported, broker_connected=True, broker_connected_at=reported,
        broker_status_updated_at=reported, updated_at=reported,
    ))
    silent = _seed(session, name="Forma plana muda")
    headers = _headers(session)

    listing = client.get("/api/devices", params={"search": "Forma plana"}, headers=headers)
    detail = client.get(f"/api/devices/{device.id}", headers=headers)

    assert listing.status_code == 200 and detail.status_code == 200
    items = {item["serial"]: item for item in listing.json()["items"]}
    for body in (items[device.serial], detail.json()):
        assert set(body) == DEVICE_READ_KEYS
        assert body["firmwareVersion"] == "2.0.0"
        assert body["ipAddress"] == "10.1.1.1"
        assert body["rssi"] == -55
        assert body["wifiSsid"] == "red"
        assert body["lastResetReason"] == "watchdog"
        assert (body["gpsLatitude"], body["gpsLongitude"]) == (-27.5, -55.5)
        assert body["effectiveLocation"] == "-27.5,-55.5"
        assert body["effectiveLocationSource"] == "device_gps"
        assert body["lastConnection"].startswith("2026-02-03T04:05:06")
        assert body["gpsUpdatedAt"].startswith("2026-02-03T04:05:06")
        assert body["brokerConnectedAt"].startswith("2026-02-03T04:05:06")
        assert body["brokerStatusUpdatedAt"].startswith("2026-02-03T04:05:06")
        assert body["brokerDisconnectedAt"] is None
        assert body["updatedAt"].startswith("2026-01-01T12:00:00")
    empty = items[silent.serial]
    assert set(empty) == DEVICE_READ_KEYS
    assert empty["firmwareVersion"] is None and empty["lastConnection"] is None
    assert empty["effectiveLocation"] is None


def test_last_connection_sort_reads_the_state_and_keeps_never_seen_devices_last(
    client: TestClient, session: Session
):
    older = _seed(session, name="Orden conexion", state=DeviceState(
        last_connection=datetime(2026, 1, 1, tzinfo=timezone.utc)))
    newer = _seed(session, name="Orden conexion", state=DeviceState(
        last_connection=datetime(2026, 1, 2, tzinfo=timezone.utc)))
    never = _seed(session, name="Orden conexion")
    headers = _headers(session)

    def order(direction: str) -> list[str]:
        response = client.get("/api/devices", headers=headers, params={
            "search": "Orden conexion", "sort_by": "lastConnection", "sort_order": direction})
        assert response.status_code == 200
        return [item["serial"] for item in response.json()["items"]]

    assert order("asc") == [older.serial, newer.serial, never.serial]
    assert order("desc") == [newer.serial, older.serial, never.serial]


def test_search_matches_the_reported_gps_location(client: TestClient, session: Session):
    located = _seed(session, name="Con GPS", state=DeviceState(gps_latitude=-31.25, gps_longitude=-64.5))
    _seed(session, name="Sin GPS")
    headers = _headers(session)

    response = client.get("/api/devices", params={"search": "-31.25,-64.5"}, headers=headers)

    assert response.status_code == 200
    assert [item["serial"] for item in response.json()["items"]] == [located.serial]
