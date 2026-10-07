"""`ota/status` (device -> backend): the attempt follows the device and history records the end."""

import json

import pytest
from sqlmodel import Session
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.firmware import mqtt_handlers
from app.api.device.firmware.models import FirmwareUpdate, FirmwareUpdateState
from app.api.device.firmware.service import FirmwareService, may_transition
from app.api.device.operations.models import DeviceOperationStatus, DeviceOperationType
from tests.api.device.firmware.support import history, ota_status, reload, seed_attempt, seed_device

TOPIC = "iot/devices/{serial}/ota/status"


@pytest.mark.asyncio
async def test_progress_updates_the_attempt_without_touching_history(session: Session, system_sessions):
    device, attempt = seed_attempt(session)
    topic = TOPIC.format(serial=device.serial)

    await mqtt_handlers.process_ota_status(topic, ota_status("accepted"))
    await mqtt_handlers.process_ota_status(topic, ota_status("downloading", progress=40))

    row = reload(session, attempt)
    assert (row.state, row.progress, row.running_version) == ("downloading", 40, "1.1.0")
    assert history(session, device.serial) == []


@pytest.mark.asyncio
async def test_success_is_recorded_once_in_history(session: Session, system_sessions):
    device, attempt = seed_attempt(session)
    topic = TOPIC.format(serial=device.serial)
    done = ota_status("succeeded", running_version="1.2.0")

    await mqtt_handlers.process_ota_status(topic, ota_status("rebooting"))
    await mqtt_handlers.process_ota_status(topic, done)
    await mqtt_handlers.process_ota_status(topic, done)  # QoS 1 redelivery

    row = reload(session, attempt)
    assert (row.state, row.running_version, row.progress) == ("succeeded", "1.2.0", 100)
    [op] = history(session, device.serial)
    assert op.operation_type == DeviceOperationType.FIRMWARE_UPDATE
    assert op.status == DeviceOperationStatus.SUCCESS
    assert op.device_id == device.id
    assert row.operation_id == op.id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("state", "error"),
    [
        ("rejected", {"code": "busy", "message": "update running"}),
        ("failed", {"code": "sha256_mismatch", "message": "bad hash"}),
        ("rolled_back", {"code": "rollback", "message": "did not validate"}),
    ],
)
async def test_a_failed_attempt_stores_the_error_and_is_recorded(session: Session, system_sessions, state, error):
    device, attempt = seed_attempt(session)

    await mqtt_handlers.process_ota_status(TOPIC.format(serial=device.serial), ota_status(state, error=error))

    row = reload(session, attempt)
    assert (row.state, row.error_code, row.error_message) == (state, error["code"], error["message"])
    [op] = history(session, device.serial)
    assert op.status == DeviceOperationStatus.FAILED


@pytest.mark.asyncio
async def test_a_late_or_stale_status_never_moves_the_attempt_back(session: Session, system_sessions):
    device, attempt = seed_attempt(session, state="installing")
    topic = TOPIC.format(serial=device.serial)

    await mqtt_handlers.process_ota_status(topic, ota_status("downloading", progress=90))
    assert reload(session, attempt).state == "installing"

    await mqtt_handlers.process_ota_status(topic, ota_status("failed", error={"code": "internal", "message": "x"}))
    await mqtt_handlers.process_ota_status(topic, ota_status("succeeded", running_version="1.2.0"))
    assert reload(session, attempt).state == "failed"  # a terminal state is final
    assert len(history(session, device.serial)) == 1


@pytest.mark.asyncio
async def test_unknown_request_ids_other_serials_and_garbage_are_ignored(session: Session, system_sessions):
    device, attempt = seed_attempt(session)
    other = seed_device(session)
    topic = TOPIC.format(serial=device.serial)

    await mqtt_handlers.process_ota_status(topic, ota_status("succeeded", request_id="nope"))
    # The right request id reported by another device is not this device's attempt.
    await mqtt_handlers.process_ota_status(TOPIC.format(serial=other.serial), ota_status("succeeded"))
    await mqtt_handlers.process_ota_status(topic, "not json")
    await mqtt_handlers.process_ota_status(topic, "[1]")
    await mqtt_handlers.process_ota_status(topic, ota_status("exploded"))
    await mqtt_handlers.process_ota_status(topic, ota_status("downloading", progress=500))
    await mqtt_handlers.process_ota_status("iot/devices//ota/status", ota_status("succeeded"))

    assert reload(session, attempt).state == "requested"
    assert history(session, device.serial) == [] and history(session, other.serial) == []


@pytest.mark.asyncio
async def test_a_lowercase_serial_in_the_topic_reaches_the_attempt(session: Session, system_sessions):
    device, attempt = seed_attempt(session)

    await mqtt_handlers.process_ota_status(TOPIC.format(serial=device.serial.lower()), ota_status("accepted"))

    assert reload(session, attempt).state == "accepted"


@pytest.mark.parametrize(
    ("current", "new", "allowed"),
    [
        ("requested", "accepted", True),
        ("accepted", "downloading", True),
        ("downloading", "downloading", True),
        ("installing", "downloading", False),  # never backwards
        ("accepted", "failed", True),  # a terminal status wins over any non-terminal
        ("requested", "rejected", True),
        ("failed", "accepted", False),  # a non-terminal never overwrites a terminal one
        ("failed", "downloading", False),
        ("failed", "succeeded", False),  # a terminal state is final
        ("succeeded", "failed", False),
        ("rejected", "accepted", False),
    ],
)
def test_transition_rules(current: str, new: str, allowed: bool):
    assert may_transition(FirmwareUpdateState(current), FirmwareUpdateState(new)) is allowed


@pytest.mark.asyncio
async def test_a_stale_read_cannot_let_accepted_overwrite_a_committed_failed(
    session: Session, async_engine, system_sessions
):
    """`accepted` and `failed` arrive ~20 ms apart and are handled concurrently. The second
    handler's session already holds the old row (stale identity map); `populate_existing` makes it
    decide on what the first one committed."""
    device, attempt = seed_attempt(session)
    topic = TOPIC.format(serial=device.serial)

    async with AsyncSession(async_engine, expire_on_commit=False) as late:
        stale = await late.get(FirmwareUpdate, attempt.id)
        assert stale.state == "requested"
        await mqtt_handlers.process_ota_status(topic, ota_status("failed", error={"code": "internal", "message": "boom"}))
        await FirmwareService(late).apply_status(device.serial, json.loads(ota_status("accepted")))

    row = reload(session, attempt)
    assert (row.state, row.error_code) == ("failed", "internal")
    assert len(history(session, device.serial)) == 1
