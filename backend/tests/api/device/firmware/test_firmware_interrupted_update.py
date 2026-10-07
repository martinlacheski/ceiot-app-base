"""The device drops off the broker in the middle of an update (power cut, Wi-Fi lost): the attempt
stops blocking new updates right away, and a final status the device sends later still wins."""

import json

import pytest
from sqlmodel import Session

from app.api.device.firmware import mqtt_handlers
from app.api.device.operations.models import DeviceOperationStatus
from app.core.mqtt import handlers as core_handlers
from tests.api.device.firmware.support import history, ota_status, reload, seed_attempt

STATUS_TOPIC = "iot/devices/{serial}/ota/status"
PRESENCE_TOPIC = "iot/devices/{serial}/status"
OFFLINE = json.dumps({"status": "offline"})
ONLINE = json.dumps({"status": "online"})


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["requested", "accepted", "downloading", "verifying", "installing"])
async def test_going_offline_mid_update_fails_the_attempt(session: Session, system_sessions, state):
    device, attempt = seed_attempt(session, state=state)

    await core_handlers.process_device_status_message(PRESENCE_TOPIC.format(serial=device.serial), OFFLINE)

    row = reload(session, attempt)
    assert (row.state, row.error_code) == ("failed", "interrupted")
    assert row.error_message == "El dispositivo se desconectó durante la actualización. No se cambió nada."
    [op] = history(session, device.serial)
    assert op.status == DeviceOperationStatus.FAILED
    session.refresh(device)
    assert device.broker_connected is False  # the presence update still happened


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["rebooting", "succeeded", "failed"])
async def test_going_offline_while_rebooting_or_after_the_end_changes_nothing(session: Session, system_sessions, state):
    device, attempt = seed_attempt(session, state=state)

    await core_handlers.process_device_status_message(PRESENCE_TOPIC.format(serial=device.serial), OFFLINE)

    assert reload(session, attempt).state == state
    assert history(session, device.serial) == []


@pytest.mark.asyncio
async def test_coming_online_does_not_touch_the_attempt(session: Session, system_sessions):
    device, attempt = seed_attempt(session, state="downloading")

    await core_handlers.process_device_status_message(PRESENCE_TOPIC.format(serial=device.serial), ONLINE)

    assert reload(session, attempt).state == "downloading"


@pytest.mark.asyncio
async def test_a_final_status_after_the_interruption_wins_and_updates_the_same_history_record(
    session: Session, system_sessions
):
    """The image was already switched when the connection dropped: the device boots it and reports
    `succeeded`, which replaces the interruption (and its history record)."""
    device, attempt = seed_attempt(session, state="installing")
    await core_handlers.process_device_status_message(PRESENCE_TOPIC.format(serial=device.serial), OFFLINE)

    await mqtt_handlers.process_ota_status(
        STATUS_TOPIC.format(serial=device.serial), ota_status("succeeded", running_version="1.2.0")
    )

    row = reload(session, attempt)
    assert (row.state, row.error_code, row.error_message) == ("succeeded", None, None)
    [op] = history(session, device.serial)
    assert op.status == DeviceOperationStatus.SUCCESS


@pytest.mark.asyncio
async def test_a_late_progress_does_not_revive_an_interrupted_attempt(session: Session, system_sessions):
    device, attempt = seed_attempt(session, state="downloading")
    await core_handlers.process_device_status_message(PRESENCE_TOPIC.format(serial=device.serial), OFFLINE)

    await mqtt_handlers.process_ota_status(
        STATUS_TOPIC.format(serial=device.serial), ota_status("downloading", progress=60)
    )

    assert reload(session, attempt).state == "failed"
