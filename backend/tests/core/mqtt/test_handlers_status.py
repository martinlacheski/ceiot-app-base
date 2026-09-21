import pytest

from app.core.mqtt import handlers


class _FakeAsyncSession:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeDeviceRepository:
    last_instance = None
    next_return_device = object()

    def __init__(self, _session):
        self.calls = []
        self.return_device = _FakeDeviceRepository.next_return_device
        _FakeDeviceRepository.last_instance = self

    async def update_broker_presence(self, serial, is_connected):
        self.calls.append({"serial": serial, "is_connected": is_connected})
        return self.return_device


@pytest.fixture
def status_handler_setup(monkeypatch):
    _FakeDeviceRepository.last_instance = None
    _FakeDeviceRepository.next_return_device = object()
    monkeypatch.setattr(handlers, "system_session", lambda: _FakeAsyncSession())
    monkeypatch.setattr(handlers, "DeviceRepository", _FakeDeviceRepository)
    return _FakeDeviceRepository


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ("online", True),
        ("offline", False),
        ('{"status": "online"}', True),
        ('{"status": "offline"}', False),
        ('{"connected": true}', True),
        ('{"connected": false}', False),
    ],
)
def test_parse_broker_presence_payload_supports_text_and_json(payload, expected):
    assert handlers._parse_broker_presence_payload(payload) is expected


def test_parse_broker_presence_payload_returns_none_for_invalid_payload():
    assert handlers._parse_broker_presence_payload("unknown") is None


@pytest.mark.asyncio
async def test_process_device_status_message_updates_known_device(status_handler_setup):
    await handlers.process_device_status_message(
        "iot/devices/iot-1000/status",
        "online",
    )

    fake_repo = status_handler_setup.last_instance
    assert fake_repo is not None
    assert fake_repo.calls == [{"serial": "iot-1000", "is_connected": True}]


@pytest.mark.asyncio
async def test_process_device_status_message_ignores_unknown_device(status_handler_setup):
    status_handler_setup.next_return_device = None

    await handlers.process_device_status_message(
        "iot/devices/IOT-4040/status",
        '{"status": "offline"}',
    )

    fake_repo = status_handler_setup.last_instance
    assert fake_repo is not None
    assert fake_repo.calls == [{"serial": "IOT-4040", "is_connected": False}]


@pytest.mark.asyncio
async def test_process_device_status_message_skips_invalid_payload(status_handler_setup):
    await handlers.process_device_status_message(
        "iot/devices/IOT-1000/status",
        "garbage",
    )

    fake_repo = status_handler_setup.last_instance
    assert fake_repo is None or fake_repo.calls == []
