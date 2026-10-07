"""Unit tests of the device emulator's OTA client (pure parts, no broker).

Run with: python3 -m pytest -q tools/test_emulador_dispositivo.py
(needs `paho-mqtt` and `pytest`, see mqtt/README.md "CLI de emulación").
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "emulador_dispositivo", Path(__file__).with_name("emulador-dispositivo.py")
)
emu = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = emu  # dataclasses resolve annotations through sys.modules
_SPEC.loader.exec_module(emu)

IMAGE = bytes([0xE9]) + bytes(range(256)) * 40
IMAGE_SHA = hashlib.sha256(IMAGE).hexdigest()


def command_json(**overrides) -> str:
    body = {
        "request_id": "req-1",
        "version": "0.0.0-emu.1",
        "url": "http://192.168.1.50:18000/api/firmware/download/tok",
        "sha256": IMAGE_SHA,
        "size": len(IMAGE),
    }
    body.update(overrides)
    return json.dumps({k: v for k, v in body.items() if v is not ...})


# --- ota/command parsing ---------------------------------------------------------------------


def test_parse_command_valid():
    command, valid = emu.parse_ota_command(command_json(force=True))
    assert valid is True
    assert command.request_id == "req-1"
    assert command.version == "0.0.0-emu.1"
    assert command.size == len(IMAGE)
    assert command.sha256 == IMAGE_SHA
    assert command.force is True


@pytest.mark.parametrize("raw", ["", "not json", "[]", json.dumps({"version": "1"}), json.dumps({"request_id": 5})])
def test_parse_command_unreadable_without_request_id(raw):
    assert emu.parse_ota_command(raw) is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"sha256": "ABC"},
        {"sha256": IMAGE_SHA.upper()},
        {"size": 0},
        {"size": True},
        {"size": 1.5},
        {"size": emu.OTA_PARTITION_BYTES + 1},
        {"url": "ftp://host/x"},
        {"url": ...},
        {"version": ...},
        {"force": "yes"},
    ],
)
def test_parse_command_invalid_keeps_request_id(overrides):
    command, valid = emu.parse_ota_command(command_json(**overrides))
    assert valid is False
    assert command.request_id == "req-1"


# --- decision ---------------------------------------------------------------------------------


def test_decide_accepts_a_new_version():
    command, valid = emu.parse_ota_command(command_json())
    assert emu.decide_ota(command, valid, running_version="emulador", busy=False) is None


def test_decide_rejects_same_version_unless_forced():
    command, valid = emu.parse_ota_command(command_json(version="emulador"))
    assert emu.decide_ota(command, valid, running_version="emulador", busy=False) == "same_version"
    forced, valid = emu.parse_ota_command(command_json(version="emulador", force=True))
    assert emu.decide_ota(forced, valid, running_version="emulador", busy=False) is None


def test_decide_rejects_busy_and_invalid():
    command, valid = emu.parse_ota_command(command_json())
    assert emu.decide_ota(command, valid, running_version="x", busy=True) == "busy"
    bad, valid = emu.parse_ota_command(command_json(size=0))
    assert emu.decide_ota(bad, valid, running_version="x", busy=False) == "invalid_command"


# --- image verification -----------------------------------------------------------------------


def test_verify_image_ok():
    assert emu.verify_image(IMAGE, len(IMAGE), IMAGE_SHA) is None


def test_verify_image_size_mismatch():
    assert emu.verify_image(IMAGE[:-1], len(IMAGE), IMAGE_SHA)[0] == "size_mismatch"


def test_verify_image_sha_mismatch():
    corrupted = IMAGE[:-1] + b"\x00"
    assert emu.verify_image(corrupted, len(IMAGE), IMAGE_SHA)[0] == "sha256_mismatch"


# --- helpers ----------------------------------------------------------------------------------


def test_rewrite_url_base_replaces_only_the_origin():
    url = "http://192.168.1.50:18000/api/firmware/download/tok"
    assert emu.rewrite_url_base(url, None) == url
    assert emu.rewrite_url_base(url, "http://localhost:18000") == "http://localhost:18000/api/firmware/download/tok"
    assert emu.rewrite_url_base(url, "http://localhost:18000/") == "http://localhost:18000/api/firmware/download/tok"


def test_progress_publishes_every_ten_percent():
    assert emu.should_publish_progress(9, last_published=0) is False
    assert emu.should_publish_progress(10, last_published=0) is True
    assert emu.should_publish_progress(100, last_published=95) is True
    assert emu.should_publish_progress(50, last_published=50) is False


def test_build_status_payload_only_carries_set_fields():
    body = emu.build_ota_status("r", "downloading", progress=30, running_version="a", target_version="b")
    assert body == {"request_id": "r", "state": "downloading", "progress": 30, "running_version": "a", "target_version": "b"}
    failed = emu.build_ota_status("r", "failed", error=("sha256_mismatch", "msg"), running_version="a", target_version="b")
    assert failed["error"] == {"code": "sha256_mismatch", "message": "msg"}
    assert "progress" not in failed


def test_telemetry_reports_the_given_firmware_version():
    payload = emu.build_telemetry_payload({"dht22": ["temperature"]}, {}, 3, firmware_version="0.0.0-emu.1")
    assert payload["firmware_version"] == "0.0.0-emu.1"
    assert emu.build_telemetry_payload({"dht22": ["temperature"]}, {}, 3)["firmware_version"] == "emulador"


# --- runner (state sequence with fakes) -------------------------------------------------------


class FakeDevice:
    def __init__(self, data: bytes = IMAGE, error: Exception | None = None):
        self.data = data
        self.error = error
        self.statuses: list[dict] = []
        self.fetched_urls: list[str] = []
        self.reboots = 0
        self.drops = 0

    def fetch(self, url, expected_size, on_progress):
        self.fetched_urls.append(url)
        if self.error:
            raise self.error
        for read in range(0, len(self.data) + 1, max(1, len(self.data) // 20)):
            on_progress(read, expected_size)
        on_progress(len(self.data), expected_size)
        return self.data

    def runner(self, **kwargs) -> "emu.OtaRunner":
        return emu.OtaRunner(
            publish_status=self.statuses.append,
            fetch=self.fetch,
            reboot=self._reboot,
            drop_connection=self._drop,
            running_version="emulador",
            step_delay=0,
            **kwargs,
        )

    def _reboot(self):
        self.reboots += 1

    def _drop(self):
        self.drops += 1

    def states(self) -> list[str]:
        return [status["state"] for status in self.statuses]


def run(device: FakeDevice, raw: str | None = None, **kwargs):
    runner = device.runner(**kwargs)
    command, valid = emu.parse_ota_command(raw or command_json())
    outcome = runner.handle(command, valid)
    return runner, outcome


def test_runner_success_sequence_and_version_bump():
    device = FakeDevice()
    runner, outcome = run(device, url_base="http://localhost:18000")
    assert outcome == "succeeded"
    states = device.states()
    assert states[0] == "accepted"
    assert states[-4:] == ["verifying", "installing", "rebooting", "succeeded"]
    downloading = [s for s in device.statuses if s["state"] == "downloading"]
    assert downloading and downloading[-1]["progress"] == 100
    assert [s["progress"] for s in downloading] == sorted(s["progress"] for s in downloading)
    assert all(s["request_id"] == "req-1" and s["target_version"] == "0.0.0-emu.1" for s in device.statuses)
    assert device.statuses[0]["running_version"] == "emulador"
    assert device.statuses[-1]["running_version"] == "0.0.0-emu.1"
    assert device.reboots == 1
    assert runner.running_version == "0.0.0-emu.1"
    assert device.fetched_urls == ["http://localhost:18000/api/firmware/download/tok"]


def test_runner_sha_mismatch_fails_and_never_installs():
    device = FakeDevice(data=IMAGE[:-1] + b"\x00")
    runner, outcome = run(device)
    assert outcome == "failed"
    assert device.states()[-2:] == ["verifying", "failed"]
    assert "installing" not in device.states()
    assert device.statuses[-1]["error"]["code"] == "sha256_mismatch"
    assert runner.running_version == "emulador"
    assert device.reboots == 0


def test_runner_fail_at_verifying_simulates_a_corrupted_image():
    device = FakeDevice()
    runner, outcome = run(device, fail_at="verifying")
    assert outcome == "failed"
    assert device.statuses[-1]["error"]["code"] == "sha256_mismatch"
    assert "installing" not in device.states()
    assert runner.running_version == "emulador"


def test_runner_fail_at_downloading_reports_download_failed():
    device = FakeDevice()
    _, outcome = run(device, fail_at="downloading")
    assert outcome == "failed"
    assert device.statuses[-1]["state"] == "failed"
    assert device.statuses[-1]["error"]["code"] == "download_failed"
    assert "verifying" not in device.states()


def test_runner_download_error_reports_its_code():
    device = FakeDevice(error=emu.OtaError("download_failed", "HTTP 404"))
    _, outcome = run(device)
    assert outcome == "failed"
    assert device.statuses[-1]["error"] == {"code": "download_failed", "message": "HTTP 404"}


def test_runner_disconnect_at_downloading_sends_no_final_status():
    device = FakeDevice()
    runner, outcome = run(device, disconnect_at="downloading")
    assert outcome == "disconnected"
    assert device.drops == 1
    assert device.states()[-1] == "downloading"
    assert "failed" not in device.states()
    assert runner.running_version == "emulador"
    assert runner.busy is False


def test_runner_rejects_same_version_and_replays_known_request():
    device = FakeDevice()
    runner = device.runner()
    command, valid = emu.parse_ota_command(command_json(version="emulador"))
    assert runner.handle(command, valid) == "rejected"
    assert device.statuses[-1]["state"] == "rejected"
    assert device.statuses[-1]["error"]["code"] == "same_version"
    count = len(device.statuses)
    assert runner.handle(command, valid) == "replayed"
    assert len(device.statuses) == count + 1
    assert device.statuses[-1] == device.statuses[-2]


# --- HTTP download ----------------------------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - http.server API
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/image")
            self.end_headers()
            return
        if self.path == "/image":
            self.send_response(200)
            self.send_header("Content-Length", str(len(IMAGE)))
            self.end_headers()
            self.wfile.write(IMAGE)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *args):  # silence
        pass


@pytest.fixture()
def http_base():
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def test_download_image_streams_and_reports_progress(http_base):
    seen: list[tuple[int, int]] = []
    data = emu.download_image(f"{http_base}/image", len(IMAGE), lambda r, t: seen.append((r, t)))
    assert data == IMAGE
    assert seen[-1] == (len(IMAGE), len(IMAGE))


def test_download_image_rejects_redirects(http_base):
    with pytest.raises(emu.OtaError) as exc:
        emu.download_image(f"{http_base}/redirect", len(IMAGE), lambda r, t: None)
    assert exc.value.code == "download_failed"


def test_download_image_http_error(http_base):
    with pytest.raises(emu.OtaError) as exc:
        emu.download_image(f"{http_base}/missing", len(IMAGE), lambda r, t: None)
    assert exc.value.code == "download_failed"


def test_download_image_stops_when_larger_than_announced(http_base):
    with pytest.raises(emu.OtaError) as exc:
        emu.download_image(f"{http_base}/image", len(IMAGE) - 10, lambda r, t: None)
    assert exc.value.code == "size_mismatch"


# --- CLI --------------------------------------------------------------------------------------


def test_cli_defaults_keep_the_previous_behavior():
    args = emu.parse_args(["--serial", "IOT-DEM0-0001"])
    assert args.ota is False
    assert args.ota_fail_at is None
    assert args.ota_disconnect_at is None
    assert args.ota_url_base is None
    assert args.firmware_version == "emulador"
    assert (args.host, args.port, args.count, args.interval) == ("localhost", 18883, 1, 5.0)


def test_cli_ota_flags():
    args = emu.parse_args(
        [
            "--serial",
            "IOT-DEM0-0001",
            "--ota",
            "--ota-url-base",
            "http://localhost:18000",
            "--ota-fail-at",
            "verifying",
            "--ota-step-delay",
            "0",
        ]
    )
    assert args.ota is True
    assert args.ota_fail_at == "verifying"
    assert args.ota_url_base == "http://localhost:18000"
    assert args.ota_step_delay == 0
    with pytest.raises(SystemExit):
        emu.parse_args(["--serial", "X", "--ota-fail-at", "installing"])
    with pytest.raises(SystemExit):
        emu.parse_args(["--serial", "X", "--ota-disconnect-at", "verifying"])
