"""`GET /firmware/download/{token}`: the short, token-authorized URL a device downloads from."""

import logging
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.device.firmware.models import FirmwareUpdate
from app.api.device.firmware.service import MAX_URL_LENGTH
from app.core.config import settings
from app.core.logging_config import DownloadTokenFilter
from app.core.time import utc_now
from tests.api.device.firmware.support import DOWNLOAD_BASE, URL, esp_image, seed_device, upload
from tests.api.device.firmware.test_firmware_start_update_api import start

IMAGE = esp_image(8192)


@pytest.fixture(name="release")
def release_fixture(client: TestClient, admin_user, storage) -> dict:
    return upload(client, admin_user, data=IMAGE).json()


@pytest.fixture(name="attempt")
def attempt_fixture(client: TestClient, session: Session, admin_user, release: dict, published: list):
    start(client, admin_user, seed_device(session), release)
    return session.exec(select(FirmwareUpdate)).one()


def test_the_command_url_is_short_and_carries_an_unguessable_token(attempt: FirmwareUpdate, published: list):
    url = published[0][1]["url"]

    assert url == f"{DOWNLOAD_BASE}{URL}/download/{attempt.download_token}"
    assert len(url) <= MAX_URL_LENGTH == 1024
    assert len(attempt.download_token) >= 32
    remaining = attempt.download_expires_at - utc_now()
    assert timedelta(minutes=9) < remaining <= timedelta(minutes=10)


def test_the_download_streams_the_exact_image_without_authentication(client: TestClient, attempt: FirmwareUpdate):
    response = client.get(f"{URL}/download/{attempt.download_token}", follow_redirects=False)

    assert response.status_code == 200
    assert response.content == IMAGE
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["content-length"] == str(len(IMAGE))
    assert response.headers["cache-control"] == "no-store"


def test_the_download_can_be_repeated_within_the_expiry_and_records_the_first_time(
    client: TestClient, session: Session, attempt: FirmwareUpdate
):
    first = client.get(f"{URL}/download/{attempt.download_token}")
    session.expire_all()
    stamped = session.exec(select(FirmwareUpdate)).one().downloaded_at
    second = client.get(f"{URL}/download/{attempt.download_token}")
    session.expire_all()

    assert first.status_code == second.status_code == 200
    assert stamped is not None
    assert session.exec(select(FirmwareUpdate)).one().downloaded_at == stamped


def test_an_expired_token_is_a_plain_404(client: TestClient, session: Session, attempt: FirmwareUpdate):
    token = attempt.download_token
    attempt.download_expires_at = utc_now() - timedelta(seconds=1)
    session.add(attempt)
    session.commit()

    response = client.get(f"{URL}/download/{token}")

    assert response.status_code == 404
    assert token not in response.text


def test_an_unknown_token_is_a_plain_404(client: TestClient, attempt: FirmwareUpdate):
    response = client.get(f"{URL}/download/not-a-real-token")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_a_token_whose_image_is_gone_from_the_store_is_a_404(client: TestClient, attempt: FirmwareUpdate, storage):
    storage.objects.clear()

    assert client.get(f"{URL}/download/{attempt.download_token}").status_code == 404


def test_an_url_over_the_device_limit_is_refused(
    client: TestClient, session: Session, admin_user, release: dict, published: list, monkeypatch
):
    monkeypatch.setattr(settings, "FIRMWARE_DOWNLOAD_BASE_URL", "https://" + "a" * 1100 + ".io")

    response = start(client, admin_user, seed_device(session), release)

    assert response.status_code == 500
    assert published == []
    assert session.exec(select(FirmwareUpdate)).all() == []


def test_the_base_falls_back_to_the_public_then_the_host_backend_url(
    client: TestClient, session: Session, admin_user, release: dict, published: list, monkeypatch
):
    monkeypatch.setattr(settings, "FIRMWARE_DOWNLOAD_BASE_URL", None)
    monkeypatch.setattr(settings, "BACKEND_PUBLIC_BASE_URL", "https://api.example.com/")
    start(client, admin_user, seed_device(session), release)
    monkeypatch.setattr(settings, "BACKEND_PUBLIC_BASE_URL", None)
    monkeypatch.setattr(settings, "BACKEND_HOST_URL", "http://localhost:8000")
    start(client, admin_user, seed_device(session), release)

    assert published[0][1]["url"].startswith("https://api.example.com/api/firmware/download/")
    assert published[1][1]["url"].startswith("http://localhost:8000/api/firmware/download/")


def test_the_access_log_never_shows_the_token():
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
        ("10.0.0.2:5000", "GET", "/api/firmware/download/SeCrEt-token_123?x=1", "1.1", 200), None,
    )

    assert DownloadTokenFilter().filter(record) is True

    assert "SeCrEt" not in record.getMessage()
    assert "/api/firmware/download/***" in record.getMessage()
