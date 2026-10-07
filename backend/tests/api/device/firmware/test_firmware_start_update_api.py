"""`POST /firmware/updates`: the rules and the `ota/command` the device receives."""

import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.device.firmware.models import FirmwareUpdate
from app.core.emqx_presence import PresenceSnapshot, get_emqx_presence_client
from app.main import app
from tests.api.device.firmware.support import (
    DOWNLOAD_BASE,
    URL,
    auth,
    esp_image,
    seed_device,
    sha256_of,
    upload,
)


@pytest.fixture(name="release")
def release_fixture(client: TestClient, admin_user, storage) -> dict:
    return upload(client, admin_user, data=esp_image(8192)).json()


def start(client: TestClient, user, device, release, **extra):
    body = {"deviceId": str(device.id), "releaseId": release["id"]}
    body.update(extra)
    return client.post(f"{URL}/updates", headers=auth(user), json=body)


def _presence(*serials: str):
    class Client:
        async def get_snapshot(self) -> PresenceSnapshot:
            return PresenceSnapshot.available_with(serials)

    app.dependency_overrides[get_emqx_presence_client] = Client


def test_it_creates_the_attempt_and_publishes_the_command(
    client: TestClient, session: Session, admin_user, release: dict, published: list
):
    device = seed_device(session)

    response = start(client, admin_user, device, release)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["state"] == "requested"
    assert body["targetVersion"] == "1.2.0"
    assert body["runningVersion"] == "1.1.0"
    assert body["deviceSerial"] == device.serial
    attempt = session.exec(select(FirmwareUpdate)).one()
    assert attempt.created_by == admin_user.id
    uuid.UUID(attempt.request_id)
    assert body["requestId"] == attempt.request_id
    assert "downloadToken" not in body

    [(topic, payload, qos)] = published
    assert topic == f"iot/devices/{device.serial}/ota/command"
    assert qos == 1
    # sha256 and size travel with the command: the device verifies the image before installing it.
    assert set(payload) == {"request_id", "version", "url", "sha256", "size"}
    assert payload["request_id"] == attempt.request_id
    assert payload["version"] == "1.2.0"
    assert payload["size"] == 8192
    assert payload["sha256"] == sha256_of(esp_image(8192))
    assert payload["url"] == f"{DOWNLOAD_BASE}/api/firmware/download/{attempt.download_token}"
    assert json.dumps(payload)


def test_force_is_forwarded_only_when_requested(
    client: TestClient, session: Session, admin_user, release: dict, published: list
):
    start(client, admin_user, seed_device(session), release, force=True)

    assert published[0][1]["force"] is True


def test_an_offline_device_is_refused_and_nothing_is_published(
    client: TestClient, session: Session, admin_user, release: dict, published: list
):
    device = seed_device(session, online=False)

    response = start(client, admin_user, device, release)

    assert response.status_code == 409
    assert response.json()["detail"] == "El dispositivo está sin conexión"
    assert published == []
    assert session.exec(select(FirmwareUpdate)).all() == []


def test_live_broker_presence_wins_over_the_stored_flag(
    client: TestClient, session: Session, admin_user, release: dict, published: list
):
    stored_offline = seed_device(session, online=False)
    stored_online = seed_device(session, online=True)
    _presence(stored_offline.serial)

    assert start(client, admin_user, stored_online, release).status_code == 409
    assert start(client, admin_user, stored_offline, release).status_code == 201


def test_an_inactive_release_is_refused(
    client: TestClient, session: Session, admin_user, release: dict, published: list
):
    client.post(f"{URL}/releases/{release['id']}/deactivate", headers=auth(admin_user))

    response = start(client, admin_user, seed_device(session), release)

    assert response.status_code == 409
    assert published == []


def test_unknown_device_or_release_is_404(
    client: TestClient, session: Session, admin_user, release: dict, published: list
):
    device = seed_device(session)

    assert start(client, admin_user, device, {"id": str(uuid.uuid4())}).status_code == 404
    ghost = type("D", (), {"id": uuid.uuid4()})()
    assert start(client, admin_user, ghost, release).status_code == 404
    assert published == []


def test_only_an_admin_may_start_an_update(
    client: TestClient, session: Session, test_user, release: dict, published: list
):
    response = start(client, test_user, seed_device(session), release)

    assert response.status_code == 403
    assert published == []


def test_a_second_update_is_refused_while_one_is_in_progress(
    client: TestClient, session: Session, admin_user, release: dict, published: list
):
    device = seed_device(session)
    assert start(client, admin_user, device, release).status_code == 201

    again = start(client, admin_user, device, release)

    assert again.status_code == 409
    assert again.json()["detail"] == "Ya hay una actualización en curso para este dispositivo"
    assert len(published) == 1


def test_an_attempt_without_a_final_state_stops_blocking_after_30_minutes(
    client: TestClient, session: Session, admin_user, release: dict, published: list
):
    from datetime import timedelta

    device = seed_device(session)
    assert start(client, admin_user, device, release).status_code == 201
    row = session.exec(select(FirmwareUpdate)).one()
    row.created_at = row.created_at - timedelta(minutes=31)
    session.add(row)
    session.commit()

    assert start(client, admin_user, device, release).status_code == 201


def test_attempts_of_a_device_are_listed_newest_first(
    client: TestClient, session: Session, admin_user, release: dict, published: list
):
    device = seed_device(session)
    first = start(client, admin_user, device, release).json()
    row = session.exec(select(FirmwareUpdate)).one()
    row.state = "failed"
    session.add(row)
    session.commit()
    second = start(client, admin_user, device, release).json()

    listed = client.get(f"{URL}/devices/{device.id}/updates", headers=auth(admin_user))

    assert listed.status_code == 200
    assert [item["requestId"] for item in listed.json()] == [second["requestId"], first["requestId"]]


def test_listing_attempts_is_admin_only(client: TestClient, session: Session, test_user):
    device = seed_device(session)

    response = client.get(f"{URL}/devices/{device.id}/updates", headers=auth(test_user))

    assert response.status_code == 403
