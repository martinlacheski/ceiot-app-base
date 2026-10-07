"""Updates the device asks for: `ota/check` and `ota/request` (device -> backend) and the
`ota/available` answer (backend -> device)."""

import json
from datetime import datetime, timedelta

import pytest
from sqlmodel import Session

from app.api.device.firmware import mqtt_handlers
from app.api.device.firmware.models import FirmwareUpdate
from tests.api.device.firmware.support import DOWNLOAD_BASE, attempts, seed_device, seed_release

CHECK = "iot/devices/{serial}/ota/check"
REQUEST = "iot/devices/{serial}/ota/request"
BASE = datetime(2026, 10, 1, 12, 0, 0)


def _release(session: Session, version: str, *, minutes: int, active: bool = True):
    return seed_release(session, version, active=active, created_at=BASE + timedelta(minutes=minutes))


def _payload(**fields) -> str:
    return json.dumps(fields)


# --- ota/check ---------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_offers_the_latest_active_release_when_it_differs_from_the_running_one(
    session: Session, system_sessions, storage, published
):
    device = seed_device(session, firmware_version="1.0.0")
    _release(session, "1.1.0", minutes=0)
    _release(session, "1.2.0", minutes=10)
    _release(session, "1.3.0", minutes=20, active=False)  # never offered

    await mqtt_handlers.process_ota_check(
        CHECK.format(serial=device.serial), _payload(request_id="c-1", running_version="1.0.0")
    )

    [(topic, payload, qos)] = published
    assert topic == f"iot/devices/{device.serial}/ota/available"
    assert qos == 1
    assert payload == {"request_id": "c-1", "version": "1.2.0", "size": 4096}
    assert attempts(session) == []  # asking creates no attempt


@pytest.mark.asyncio
async def test_check_answers_null_when_the_device_already_runs_the_latest_release(
    session: Session, system_sessions, storage, published
):
    device = seed_device(session, firmware_version="1.2.0")
    _release(session, "1.2.0", minutes=10)

    await mqtt_handlers.process_ota_check(
        CHECK.format(serial=device.serial), _payload(request_id="c-2", running_version="1.2.0")
    )

    [(_, payload, _)] = published
    assert payload == {"request_id": "c-2", "version": None}


@pytest.mark.asyncio
async def test_check_falls_back_to_the_stored_version_and_answers_null_without_releases(
    session: Session, system_sessions, storage, published
):
    device = seed_device(session, firmware_version="1.2.0")

    await mqtt_handlers.process_ota_check(CHECK.format(serial=device.serial), _payload(request_id="c-3"))
    _release(session, "1.2.0", minutes=0)
    await mqtt_handlers.process_ota_check(CHECK.format(serial=device.serial), _payload(request_id="c-4"))

    assert [p for (_, p, _) in published] == [
        {"request_id": "c-3", "version": None},
        {"request_id": "c-4", "version": None},
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        "not json",
        "[1]",
        json.dumps({"running_version": "x"}),
        json.dumps({"request_id": ""}),
        json.dumps({"request_id": 7}),
        json.dumps({"request_id": "x" * 65}),
    ],
)
async def test_check_ignores_garbage_and_unknown_devices(session: Session, system_sessions, storage, published, body):
    device = seed_device(session)
    _release(session, "1.2.0", minutes=0)

    await mqtt_handlers.process_ota_check(CHECK.format(serial=device.serial), body)
    await mqtt_handlers.process_ota_check(CHECK.format(serial="IOT-ZZZZ-ZZZZ"), _payload(request_id="c-6"))
    await mqtt_handlers.process_ota_check("iot/devices//ota/check", _payload(request_id="c-6"))

    assert published == []


# --- ota/request -------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_request_creates_the_attempt_with_the_device_request_id_and_sends_the_command(
    session: Session, system_sessions, storage, published
):
    device = seed_device(session, firmware_version="1.0.0")
    release = _release(session, "1.2.0", minutes=0)

    await mqtt_handlers.process_ota_request(
        REQUEST.format(serial=device.serial),
        _payload(request_id="r-1", version="1.2.0", running_version="1.0.0"),
    )

    [attempt] = attempts(session)
    assert attempt.request_id == "r-1"
    assert (attempt.device_id, attempt.release_id) == (device.id, release.id)
    assert attempt.state == "requested" and attempt.created_by is None
    assert attempt.target_version == "1.2.0" and attempt.running_version == "1.0.0"
    [(topic, payload, qos)] = published
    assert topic == f"iot/devices/{device.serial}/ota/command" and qos == 1
    assert set(payload) == {"request_id", "version", "url", "sha256", "size"}  # no force
    assert payload["url"] == f"{DOWNLOAD_BASE}/api/firmware/download/{attempt.download_token}"


@pytest.mark.asyncio
async def test_a_redelivered_request_does_nothing_twice(session: Session, system_sessions, storage, published):
    device = seed_device(session)
    _release(session, "1.2.0", minutes=0)
    topic = REQUEST.format(serial=device.serial)
    body = _payload(request_id="r-2", version="1.2.0")

    await mqtt_handlers.process_ota_request(topic, body)
    await mqtt_handlers.process_ota_request(topic, body)

    assert len(attempts(session)) == 1
    assert len(published) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("setup", "code"),
    [
        ("missing", "release_unavailable"),
        ("inactive", "release_unavailable"),
        ("in_progress", "in_progress"),
        ("same_version", "same_version"),
    ],
)
async def test_request_refusals_are_answered_with_ota_available_and_no_command(
    session: Session, system_sessions, storage, published, setup, code
):
    device = seed_device(session, firmware_version="1.0.0")
    body = {"request_id": "r-3", "version": "1.2.0"}
    if setup == "inactive":
        _release(session, "1.2.0", minutes=0, active=False)
    elif setup == "in_progress":
        release = _release(session, "1.2.0", minutes=0)
        session.add(
            FirmwareUpdate(
                request_id="earlier",
                device_id=device.id,
                device_serial=device.serial,
                release_id=release.id,
                state="downloading",
                target_version="1.2.0",
            )
        )
        session.commit()
    elif setup == "same_version":
        _release(session, "1.2.0", minutes=0)
        body["running_version"] = "1.2.0"

    await mqtt_handlers.process_ota_request(REQUEST.format(serial=device.serial), _payload(**body))

    [(topic, payload, qos)] = published
    assert topic == f"iot/devices/{device.serial}/ota/available" and qos == 1
    assert payload["request_id"] == "r-3" and payload["version"] is None
    assert payload["error"]["code"] == code and payload["error"]["message"]
    assert [a.request_id for a in attempts(session)] == (["earlier"] if setup == "in_progress" else [])


@pytest.mark.asyncio
async def test_request_without_object_storage_is_answered_with_an_internal_error(
    session: Session, system_sessions, monkeypatch, published
):
    def unconfigured():
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail="Almacenamiento no configurado")

    monkeypatch.setattr(mqtt_handlers, "get_storage", unconfigured)
    device = seed_device(session)
    _release(session, "1.2.0", minutes=0)

    await mqtt_handlers.process_ota_request(
        REQUEST.format(serial=device.serial), _payload(request_id="r-4", version="1.2.0")
    )

    [(_, payload, _)] = published
    assert payload["error"]["code"] == "internal"
    assert attempts(session) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        "not json",
        "[1]",
        json.dumps({"request_id": "r"}),
        json.dumps({"version": "v"}),
        json.dumps({"request_id": "r", "version": 3}),
    ],
)
async def test_request_ignores_garbage(session: Session, system_sessions, storage, published, body):
    device = seed_device(session)
    _release(session, "1.2.0", minutes=0)

    await mqtt_handlers.process_ota_request(REQUEST.format(serial=device.serial), body)

    assert published == [] and attempts(session) == []
