"""MQTT time-sync fallback: iot/devices/{serial}/time/request -> .../time.

Firmware falls back to this when NTP fails (e.g. behind a captive/hotspot
network) but MQTT is reachable.
"""

import json
import re

import pytest

from app.core.mqtt import handlers


class _FakeAsyncSession:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeDevice:
    def __init__(self, serial="IOT-1000-0001", *, enabled=True, is_active=True):
        self.serial = serial
        self.enabled = enabled
        self.is_active = is_active


class _FakeDeviceRepository:
    last_instance = None
    next_return_device = None

    def __init__(self, _session):
        self.calls = []
        self.return_device = _FakeDeviceRepository.next_return_device
        _FakeDeviceRepository.last_instance = self

    async def get_by_serial(self, serial):
        self.calls.append(serial)
        return self.return_device


class _FakeMqttClient:
    def __init__(self):
        self.published = []

    def publish(self, topic, message, qos=1, retain=False):
        self.published.append({"topic": topic, "message": message, "qos": qos, "retain": retain})


@pytest.fixture
def time_sync_setup(monkeypatch):
    _FakeDeviceRepository.last_instance = None
    _FakeDeviceRepository.next_return_device = _FakeDevice()
    fake_client = _FakeMqttClient()
    monkeypatch.setattr(handlers, "system_session", lambda: _FakeAsyncSession())
    monkeypatch.setattr(handlers, "DeviceRepository", _FakeDeviceRepository)
    monkeypatch.setattr(handlers, "get_mqtt_client", lambda: fake_client)
    return _FakeDeviceRepository, fake_client


@pytest.mark.asyncio
async def test_known_enabled_device_gets_a_time_response(time_sync_setup):
    repo_cls, fake_client = time_sync_setup

    await handlers.process_time_sync_request(
        "iot/devices/IOT-1000-0001/time/request",
        json.dumps({"req_id": "abc123"}),
    )

    assert repo_cls.last_instance.calls == ["IOT-1000-0001"]
    assert len(fake_client.published) == 1
    sent = fake_client.published[0]
    assert sent["topic"] == "iot/devices/IOT-1000-0001/time"
    assert sent["qos"] == 1
    assert sent["retain"] is False
    assert sent["message"]["req_id"] == "abc123"
    assert isinstance(sent["message"]["epoch_ms"], int)
    assert sent["message"]["epoch_ms"] > 1_700_000_000_000  # sanity: looks like a real ms epoch
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", sent["message"]["iso"])


@pytest.mark.asyncio
async def test_missing_req_id_echoes_null(time_sync_setup):
    _repo_cls, fake_client = time_sync_setup

    await handlers.process_time_sync_request("iot/devices/IOT-1000-0001/time/request", "")

    assert fake_client.published[0]["message"]["req_id"] is None


@pytest.mark.asyncio
async def test_invalid_json_payload_is_tolerated(time_sync_setup):
    _repo_cls, fake_client = time_sync_setup

    await handlers.process_time_sync_request("iot/devices/IOT-1000-0001/time/request", "{not json")

    assert len(fake_client.published) == 1
    assert fake_client.published[0]["message"]["req_id"] is None


@pytest.mark.asyncio
async def test_non_object_json_payload_is_tolerated(time_sync_setup):
    _repo_cls, fake_client = time_sync_setup

    await handlers.process_time_sync_request("iot/devices/IOT-1000-0001/time/request", "[1, 2]")

    assert len(fake_client.published) == 1
    assert fake_client.published[0]["message"]["req_id"] is None


@pytest.mark.asyncio
async def test_req_id_longer_than_64_chars_is_ignored(time_sync_setup):
    _repo_cls, fake_client = time_sync_setup

    await handlers.process_time_sync_request(
        "iot/devices/IOT-1000-0001/time/request",
        json.dumps({"req_id": "x" * 65}),
    )

    assert fake_client.published[0]["message"]["req_id"] is None


@pytest.mark.asyncio
async def test_unknown_device_gets_no_response(time_sync_setup):
    repo_cls, fake_client = time_sync_setup
    repo_cls.next_return_device = None

    await handlers.process_time_sync_request("iot/devices/IOT-9999-9999/time/request", "{}")

    assert fake_client.published == []


@pytest.mark.asyncio
async def test_disabled_device_gets_no_response(time_sync_setup):
    repo_cls, fake_client = time_sync_setup
    repo_cls.next_return_device = _FakeDevice(enabled=False)

    await handlers.process_time_sync_request("iot/devices/IOT-1000-0001/time/request", "{}")

    assert fake_client.published == []


@pytest.mark.asyncio
async def test_inactive_device_gets_no_response(time_sync_setup):
    repo_cls, fake_client = time_sync_setup
    repo_cls.next_return_device = _FakeDevice(is_active=False)

    await handlers.process_time_sync_request("iot/devices/IOT-1000-0001/time/request", "{}")

    assert fake_client.published == []


@pytest.mark.asyncio
async def test_invalid_topic_is_ignored(time_sync_setup):
    repo_cls, fake_client = time_sync_setup

    await handlers.process_time_sync_request("not/a/device/topic", "{}")

    assert repo_cls.last_instance is None
    assert fake_client.published == []


@pytest.mark.asyncio
async def test_handler_never_raises_on_unexpected_failure(time_sync_setup, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(handlers, "get_mqtt_client", boom)

    # Must not raise.
    await handlers.process_time_sync_request("iot/devices/IOT-1000-0001/time/request", "{}")


def test_parse_time_request_req_id_variants():
    assert handlers._parse_time_request_req_id("") is None
    assert handlers._parse_time_request_req_id("not json") is None
    assert handlers._parse_time_request_req_id('{"req_id": 123}') is None
    assert handlers._parse_time_request_req_id('{"req_id": ""}') is None
    assert handlers._parse_time_request_req_id('{"req_id": "abc"}') == "abc"
