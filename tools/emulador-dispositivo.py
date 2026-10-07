#!/usr/bin/env python3
"""Emulador de dispositivo IoT sobre mTLS.

Se conecta al broker EMQX con el certificado de cliente real de un
dispositivo (el mismo mecanismo que usa el firmware) y publica lecturas de
telemetría realistas en ``iot/devices/{serial}/telemetry``. Ejercita el
camino completo y seguro: broker (mTLS) -> mqtt-runtime -> validación -> DB,
sin pasar por el backend ni por la UI de administración.

Uso rápido (con el entorno de desarrollo levantado):

    python3 tools/emulador-dispositivo.py --serial IOT-DEM0-0001 \\
        --sensors "dht22:temperature,relative_humidity" --count 3

Con ``--ota`` además queda conectado como el equipo (client id = serial) y
atiende ``iot/devices/{serial}/ota/command`` igual que el cliente OTA del
firmware: descarga la imagen, verifica tamaño y SHA-256, informa los estados
en ``ota/status`` y, al "reiniciar", pasa a reportar la versión nueva.

Ver la sección "CLI de emulación" en mqtt/README.md para más ejemplos y
para correrlo con el certificado montado dentro del contenedor backend.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import queue
import random
import re
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

try:
    import paho.mqtt.client as mqtt
except ImportError:  # pragma: no cover - guidance for missing dependency
    print(
        "Falta la dependencia 'paho-mqtt'. Instalala con:\n"
        "  python3 -m venv .venv && source .venv/bin/activate && pip install paho-mqtt==2.1.0\n"
        "o corré este script dentro del contenedor backend (que ya la tiene):\n"
        "  docker compose exec backend python3 /app/../tools/emulador-dispositivo.py ...",
        file=sys.stderr,
    )
    raise


# Rangos realistas por defecto por variable (mismos valores que el seed del
# catálogo de sensores, ver backend/app/api/sensor_catalog/constants.py).
DEFAULT_VARIABLE_RANGES = {
    "temperature": (18.0, 28.0),
    "relative_humidity": (35.0, 65.0),
    "pressure": (995.0, 1025.0),
}


def parse_sensors_spec(spec: str) -> dict[str, list[str]]:
    """Parse "dht22:temperature,relative_humidity;bmp280:pressure" into a dict.

    Also accepts a single "key:var1,var2" with no ';' for one sensor.
    """
    sensors: dict[str, list[str]] = {}
    for chunk in spec.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if ":" not in chunk:
            raise ValueError(
                f"Formato inválido en --sensors: {chunk!r}. Esperado 'clave:variable1,variable2'."
            )
        key, variables_part = chunk.split(":", 1)
        key = key.strip()
        variables = [v.strip() for v in variables_part.split(",") if v.strip()]
        if not key or not variables:
            raise ValueError(f"Formato inválido en --sensors: {chunk!r}.")
        sensors[key] = variables
    if not sensors:
        raise ValueError("--sensors no puede estar vacío.")
    return sensors


def random_walk_value(previous: float | None, minimum: float, maximum: float) -> float:
    """Small realistic step within [minimum, maximum]; anchors near the mid-range on first call."""
    span = maximum - minimum
    if previous is None:
        return round(minimum + span * random.uniform(0.35, 0.65), 2)
    step = span * 0.03 * random.uniform(-1, 1)
    return round(min(maximum, max(minimum, previous + step)), 2)


def build_telemetry_payload(
    sensors: dict[str, list[str]],
    last_values: dict[str, dict[str, float]],
    uptime_seconds: int,
    firmware_version: str = "emulador",
) -> dict:
    values: dict[str, dict[str, float]] = {}
    for key, variables in sensors.items():
        measurements: dict[str, float] = {}
        for variable in variables:
            minimum, maximum = DEFAULT_VARIABLE_RANGES.get(variable, (0.0, 100.0))
            previous = last_values.get(key, {}).get(variable)
            measurements[variable] = random_walk_value(previous, minimum, maximum)
        values[key] = measurements
        last_values[key] = measurements
    return {
        "sensors": values,
        "uptime": uptime_seconds,
        "firmware_version": firmware_version,
    }


def resolve_cert_paths(cert_dir: Path) -> tuple[Path, Path, Path]:
    ca = cert_dir / "root.crt"
    cert = cert_dir / "client.crt"
    key = cert_dir / "client.key"
    missing = [str(p) for p in (ca, cert, key) if not p.is_file()]
    if missing:
        raise FileNotFoundError(
            "Faltan archivos de certificado en "
            f"{cert_dir}: {', '.join(missing)}.\n"
            "Generalos con mqtt/emitir-certificado-dispositivo.sh <serial> "
            "(ver mqtt/README.md)."
        )
    return ca, cert, key


def build_client(
    serial: str, host: str, ca: Path, cert: Path, key: Path, client_id: str | None = None
) -> "mqtt.Client":
    client = mqtt.Client(client_id=client_id or f"emulador-{serial}-{uuid.uuid4().hex[:8]}")
    client.tls_set(
        ca_certs=str(ca),
        certfile=str(cert),
        keyfile=str(key),
        cert_reqs=ssl.CERT_REQUIRED,
        tls_version=ssl.PROTOCOL_TLS_CLIENT,
    )
    # The broker's certificate SANs are emqx/localhost/127.0.0.1: connecting
    # by any of those hostnames verifies correctly. Anything else (a LAN IP,
    # a different hostname) needs a broker cert reissued with that SAN, or
    # explicit hostname-verification bypass is NOT offered here on purpose
    # (mTLS without hostname verification defeats its own purpose).
    client.tls_insecure_set(False)
    return client


def emulate_telemetry(args: argparse.Namespace) -> int:
    cert_dir = Path(args.cert_dir) if args.cert_dir else Path("mqtt/pki/devices") / args.serial
    ca, cert, key = resolve_cert_paths(cert_dir)
    sensors = parse_sensors_spec(args.sensors)

    client = build_client(args.serial, args.host, ca, cert, key)

    print(f"Conectando a {args.host}:{args.port} como {args.serial} (mTLS)...")
    client.connect(args.host, args.port, keepalive=30)
    client.loop_start()

    time.sleep(0.5)  # give the TLS handshake a moment before the first publish

    last_values: dict[str, dict[str, float]] = {}
    topic = f"iot/devices/{args.serial}/telemetry"
    start = time.monotonic()
    try:
        for i in range(args.count):
            uptime = int(time.monotonic() - start)
            payload = build_telemetry_payload(sensors, last_values, uptime, args.firmware_version)
            result = client.publish(topic, json.dumps(payload), qos=1)
            result.wait_for_publish(timeout=5)
            print(f"[{i + 1}/{args.count}] -> {topic}: {json.dumps(payload)}")
            if i + 1 < args.count:
                time.sleep(args.interval)

        if args.pedir_hora:
            request_time(client, args.serial)
    finally:
        client.loop_stop()
        client.disconnect()

    return 0


def request_time(client: "mqtt.Client", serial: str) -> None:
    response_topic = f"iot/devices/{serial}/time"
    request_topic = f"iot/devices/{serial}/time/request"
    req_id = uuid.uuid4().hex[:12]
    received: dict = {}

    def on_message(_client, _userdata, msg):
        if msg.topic == response_topic:
            try:
                received.update(json.loads(msg.payload.decode()))
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

    client.on_message = on_message
    client.subscribe(response_topic, qos=1)
    time.sleep(0.3)

    print(f"Pidiendo hora en {request_topic} (req_id={req_id})...")
    client.publish(request_topic, json.dumps({"req_id": req_id}), qos=1)

    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline and not received:
        time.sleep(0.1)

    if received:
        print(f"Respuesta de hora recibida en {response_topic}: {json.dumps(received)}")
    else:
        print(
            f"Sin respuesta en {response_topic} después de 3s. Revisá los logs de "
            "mqtt-runtime (docker compose logs mqtt-runtime) — solo responde si el "
            "dispositivo existe, está habilitado y activo en la base."
        )


# --- OTA client ------------------------------------------------------------------------------
#
# Same contract as the firmware OTA client (backend/app/api/device/firmware/service.py and
# status.py): `ota/command` (backend -> device) carries request_id, version, url, sha256, size
# and an optional force; the device answers every step on `ota/status` echoing the request_id.

# `ota_0`/`ota_1` in esp32/partitions.csv (backend `MAX_IMAGE_BYTES`).
OTA_PARTITION_BYTES = 0x400000
OTA_MAX_URL_LENGTH = 1024
OTA_FAIL_POINTS = ("downloading", "verifying")
OTA_DISCONNECT_POINTS = ("downloading",)
# Download percentage at which the simulated failures/disconnections happen.
OTA_INJECT_AT_PERCENT = 50
OTA_PROGRESS_STEP = 10
OTA_REBOOT_SECONDS = 2.0
OTA_DROP_SECONDS = 5.0
_SHA256_HEX = re.compile(r"[0-9a-f]{64}")

OTA_ERROR_MESSAGES = {
    "busy": "El equipo ya está instalando otra actualización.",
    "same_version": "El equipo ya tiene esta versión.",
    "invalid_command": "La orden de actualización es inválida.",
    "download_failed": "No se pudo descargar la imagen.",
    "size_mismatch": "El tamaño de la imagen descargada no coincide.",
    "sha256_mismatch": "El SHA-256 de la imagen descargada no coincide.",
}


class OtaError(Exception):
    """A failed OTA step: `code` goes to `ota/status.error.code`, the message is shown to the admin."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class OtaConnectionDropped(Exception):
    """The emulator cut its own connection on purpose (`--ota-disconnect-at`)."""


@dataclass(frozen=True)
class OtaCommand:
    request_id: str
    version: str = ""
    url: str = ""
    sha256: str = ""
    size: int = 0
    force: bool = False


def _bounded_str(value, max_length: int) -> str | None:
    if isinstance(value, str) and 1 <= len(value) <= max_length:
        return value
    return None


def _url_is_valid(url: str | None) -> bool:
    if url is None:
        return False
    parsed = urllib.parse.urlsplit(url)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def parse_ota_command(raw: str | bytes) -> tuple[OtaCommand, bool] | None:
    """`(command, valid)`, or None when there is no request id to answer to (unreadable)."""
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    request_id = _bounded_str(data.get("request_id"), 64)
    if request_id is None:
        return None

    valid = True
    version = _bounded_str(data.get("version"), 32)
    url = _bounded_str(data.get("url"), OTA_MAX_URL_LENGTH)
    sha256 = data.get("sha256")
    size = data.get("size")
    force = data.get("force")
    if version is None or not _url_is_valid(url):
        valid = False
    if not isinstance(sha256, str) or _SHA256_HEX.fullmatch(sha256) is None:
        valid = False
        sha256 = ""
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= OTA_PARTITION_BYTES:
        valid = False
        size = 0
    if force is not None and not isinstance(force, bool):
        valid = False
        force = False
    command = OtaCommand(
        request_id=request_id,
        version=version or "",
        url=url or "",
        sha256=sha256,
        size=size,
        force=bool(force),
    )
    return command, valid


def decide_ota(command: OtaCommand, valid: bool, *, running_version: str, busy: bool) -> str | None:
    """None to accept, otherwise the rejection error code."""
    if busy:
        return "busy"
    if not valid:
        return "invalid_command"
    if not command.force and command.version == running_version:
        return "same_version"
    return None


def verify_image(data: bytes, expected_size: int, expected_sha256: str) -> tuple[str, str] | None:
    """None when the image matches the command, otherwise `(code, message)`. Never install on error."""
    if len(data) != expected_size:
        return (
            "size_mismatch",
            f"{OTA_ERROR_MESSAGES['size_mismatch']} Esperado {expected_size} bytes, recibido {len(data)}.",
        )
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        return "sha256_mismatch", OTA_ERROR_MESSAGES["sha256_mismatch"]
    return None


def rewrite_url_base(url: str, base: str | None) -> str:
    """Replaces the scheme and host of `url` with `base` (`--ota-url-base`); the path is kept."""
    if not base:
        return url
    target = urllib.parse.urlsplit(url)
    origin = urllib.parse.urlsplit(base.rstrip("/"))
    return urllib.parse.urlunsplit((origin.scheme, origin.netloc, target.path, target.query, target.fragment))


def ota_percent(read: int, total: int) -> int:
    if total <= 0:
        return 0
    return min(100, (read * 100) // total)


def should_publish_progress(percent: int, *, last_published: int) -> bool:
    if percent <= last_published:
        return False
    return percent == 100 or percent - last_published >= OTA_PROGRESS_STEP


def build_ota_status(
    request_id: str,
    state: str,
    *,
    progress: int | None = None,
    error: tuple[str, str] | None = None,
    running_version: str | None = None,
    target_version: str | None = None,
) -> dict:
    """Body of `ota/status` with the field names of the backend's `OtaStatusPayload`."""
    body: dict = {"request_id": request_id, "state": state}
    if progress is not None:
        body["progress"] = progress
    if error is not None:
        body["error"] = {"code": error[0], "message": error[1]}
    if running_version:
        body["running_version"] = running_version
    if target_version:
        body["target_version"] = target_version
    return body


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise OtaError(
            "download_failed",
            f"Redirección rechazada (HTTP {code}): la URL de descarga tiene que ser la final.",
        )


def download_image(
    url: str,
    expected_size: int,
    on_progress: Callable[[int, int], None],
    timeout: float = 30.0,
    chunk_size: int = 4096,
) -> bytes:
    """Streams the image (plain HTTP allowed, redirects rejected), never more than `expected_size`."""
    opener = urllib.request.build_opener(_RejectRedirects)
    try:
        with opener.open(url, timeout=timeout) as response:
            if response.status != 200:
                raise OtaError("download_failed", f"{OTA_ERROR_MESSAGES['download_failed']} HTTP {response.status}.")
            chunks: list[bytes] = []
            read = 0
            on_progress(0, expected_size)
            while True:
                chunk = response.read(chunk_size)
                if not chunk:
                    break
                read += len(chunk)
                if read > expected_size:
                    raise OtaError(
                        "size_mismatch",
                        f"{OTA_ERROR_MESSAGES['size_mismatch']} La descarga supera {expected_size} bytes.",
                    )
                chunks.append(chunk)
                on_progress(read, expected_size)
            return b"".join(chunks)
    except urllib.error.HTTPError as exc:
        raise OtaError("download_failed", f"{OTA_ERROR_MESSAGES['download_failed']} HTTP {exc.code}.") from exc
    except (urllib.error.URLError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise OtaError("download_failed", f"{OTA_ERROR_MESSAGES['download_failed']} {reason}"[:500]) from exc


class OtaRunner:
    """Runs one `ota/command` like the firmware does. I/O is injected so the sequence is testable:
    `publish_status(body)`, `fetch(url, size, on_progress) -> bytes`, `reboot()` (disconnect and
    come back) and `drop_connection()` (abrupt cut, the broker publishes the LWT)."""

    def __init__(
        self,
        *,
        publish_status: Callable[[dict], None],
        fetch: Callable[[str, int, Callable[[int, int], None]], bytes],
        reboot: Callable[[], None],
        drop_connection: Callable[[], None],
        running_version: str,
        fail_at: str | None = None,
        disconnect_at: str | None = None,
        url_base: str | None = None,
        step_delay: float = 1.0,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._publish_status = publish_status
        self._fetch = fetch
        self._reboot = reboot
        self._drop_connection = drop_connection
        self.running_version = running_version
        self.fail_at = fail_at
        self.disconnect_at = disconnect_at
        self.url_base = url_base
        self.step_delay = step_delay
        self._sleep = sleep
        self.busy = False
        self._last_status: dict[str, dict] = {}

    def _report(self, command: OtaCommand, state: str, **fields) -> None:
        body = build_ota_status(
            command.request_id,
            state,
            running_version=self.running_version,
            target_version=command.version or None,
            **fields,
        )
        self._last_status[command.request_id] = body
        self._publish_status(body)
        print(f"   ota/status -> {json.dumps(body)}")

    def _pause(self) -> None:
        if self.step_delay > 0:
            self._sleep(self.step_delay)

    def handle(self, command: OtaCommand, valid: bool) -> str:
        """Returns the outcome: succeeded, failed, rejected, replayed or disconnected."""
        if command.request_id in self._last_status:
            # QoS 1 redelivery of a command already handled: repeat its last status.
            self._publish_status(self._last_status[command.request_id])
            return "replayed"
        rejection = decide_ota(command, valid, running_version=self.running_version, busy=self.busy)
        if rejection is not None:
            self._report(command, "rejected", error=(rejection, OTA_ERROR_MESSAGES[rejection]))
            return "rejected"
        self.busy = True
        try:
            return self._install(command)
        finally:
            self.busy = False

    def _install(self, command: OtaCommand) -> str:
        self._report(command, "accepted")
        self._pause()
        self._report(command, "downloading", progress=0)
        last = 0

        def on_progress(read: int, total: int) -> None:
            nonlocal last
            percent = ota_percent(read, total)
            if percent >= OTA_INJECT_AT_PERCENT:
                if self.disconnect_at == "downloading":
                    print("   Cortando la conexión a mitad de la descarga (--ota-disconnect-at downloading).")
                    self._drop_connection()
                    raise OtaConnectionDropped()
                if self.fail_at == "downloading":
                    raise OtaError("download_failed", "Falla de descarga simulada (--ota-fail-at downloading).")
            if should_publish_progress(percent, last_published=last):
                last = percent
                self._report(command, "downloading", progress=percent)
                self._pause()

        try:
            data = self._fetch(rewrite_url_base(command.url, self.url_base), command.size, on_progress)
        except OtaConnectionDropped:
            return "disconnected"
        except OtaError as exc:
            self._report(command, "failed", error=(exc.code, exc.message))
            return "failed"

        if self.fail_at == "verifying" and data:
            data = data[:-1] + bytes([data[-1] ^ 0xFF])  # simulated corruption in transit
        self._report(command, "verifying")
        self._pause()
        mismatch = verify_image(data, command.size, command.sha256)
        if mismatch is not None:
            self._report(command, "failed", error=mismatch)
            return "failed"

        self._report(command, "installing")
        self._pause()
        self._report(command, "rebooting")
        self._pause()
        self._reboot()
        self.running_version = command.version
        self._report(command, "succeeded", progress=100)
        return "succeeded"


class DeviceConnection:
    """MQTT session of the emulated device in `--ota` mode: client id = serial (as the firmware,
    so the backend sees it online), retained LWT `offline` on `status`, `ota/command` subscribed
    on every (re)connection."""

    def __init__(self, args: argparse.Namespace, ca: Path, cert: Path, key: Path):
        self.serial = args.serial
        self.host = args.host
        self.port = args.port
        self.status_topic = f"iot/devices/{self.serial}/status"
        self.command_topic = f"iot/devices/{self.serial}/ota/command"
        self.on_command: Callable[[bytes], None] = lambda raw: None
        self._connected = threading.Event()
        self.client = build_client(self.serial, self.host, ca, cert, key, client_id=self.serial)
        self.client.will_set(self.status_topic, self._presence("offline"), qos=1, retain=True)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    def _presence(self, status: str) -> str:
        return json.dumps({"serial": self.serial, "status": status})

    def _on_connect(self, client, _userdata, _flags, rc):
        if rc != 0:
            print(f"Conexión rechazada por el broker (rc={rc}).", file=sys.stderr)
            return
        client.subscribe(self.command_topic, qos=1)
        client.publish(self.status_topic, self._presence("online"), qos=1, retain=True)
        self._connected.set()

    def _on_message(self, _client, _userdata, msg):
        if msg.topic == self.command_topic:
            self.on_command(msg.payload)

    def _wait_connected(self) -> None:
        if not self._connected.wait(timeout=15):
            raise ConnectionError(f"No se pudo conectar a {self.host}:{self.port} como {self.serial}.")

    def connect(self) -> None:
        self._connected.clear()
        self.client.connect(self.host, self.port, keepalive=30)
        self.client.loop_start()
        self._wait_connected()

    def publish(self, topic: str, body: dict | str, *, wait: bool = True) -> None:
        info = self.client.publish(topic, body if isinstance(body, str) else json.dumps(body), qos=1)
        if wait:
            info.wait_for_publish(timeout=5)

    def reboot(self, downtime: float = OTA_REBOOT_SECONDS) -> None:
        print(f"   Reiniciando (desconexión limpia, vuelve en {downtime:g}s)...")
        self.client.disconnect()
        self.client.loop_stop()
        time.sleep(downtime)
        self._reconnect()

    def drop(self, downtime: float = OTA_DROP_SECONDS) -> None:
        """Abrupt cut (no MQTT DISCONNECT): the broker publishes the LWT, like a power cut."""
        self.client.loop_stop()
        sock = self.client.socket()
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()
        print(f"   Conexión cortada; reconecta en {downtime:g}s con la versión anterior.")
        time.sleep(downtime)
        self._reconnect()

    def _reconnect(self) -> None:
        self._connected.clear()
        self.client.reconnect()
        self.client.loop_start()
        self._wait_connected()

    def close(self) -> None:
        # A clean DISCONNECT does not fire the LWT: publish the offline presence ourselves.
        try:
            info = self.client.publish(self.status_topic, self._presence("offline"), qos=1, retain=True)
            info.wait_for_publish(timeout=5)
        finally:
            self.client.disconnect()
            self.client.loop_stop()


def emulate_with_ota(args: argparse.Namespace) -> int:
    cert_dir = Path(args.cert_dir) if args.cert_dir else Path("mqtt/pki/devices") / args.serial
    ca, cert, key = resolve_cert_paths(cert_dir)
    sensors = parse_sensors_spec(args.sensors)

    connection = DeviceConnection(args, ca, cert, key)
    ota_status_topic = f"iot/devices/{args.serial}/ota/status"
    telemetry_topic = f"iot/devices/{args.serial}/telemetry"
    commands: "queue.Queue[tuple[OtaCommand, bool]]" = queue.Queue()

    runner = OtaRunner(
        publish_status=lambda body: connection.publish(ota_status_topic, body),
        fetch=download_image,
        reboot=connection.reboot,
        drop_connection=connection.drop,
        running_version=args.firmware_version,
        fail_at=args.ota_fail_at,
        disconnect_at=args.ota_disconnect_at,
        url_base=args.ota_url_base,
        step_delay=args.ota_step_delay,
    )

    def on_command(raw: bytes) -> None:
        # Runs on the MQTT network thread: never block here (no wait_for_publish).
        parsed = parse_ota_command(raw)
        if parsed is None:
            print("ota/command ignorado: sin request_id legible.")
            return
        command, valid = parsed
        print(f"ota/command recibido: request_id={command.request_id} version={command.version}")
        if runner.busy:
            body = build_ota_status(
                command.request_id,
                "rejected",
                error=("busy", OTA_ERROR_MESSAGES["busy"]),
                running_version=runner.running_version,
                target_version=command.version or None,
            )
            connection.publish(ota_status_topic, body, wait=False)
            return
        commands.put((command, valid))

    connection.on_command = on_command
    print(f"Conectando a {args.host}:{args.port} como {args.serial} (mTLS, modo OTA)...")
    connection.connect()
    print(
        f"Conectado. Versión {runner.running_version}. Esperando órdenes en "
        f"{connection.command_topic} (Ctrl+C para salir)."
    )

    last_values: dict[str, dict[str, float]] = {}
    start = time.monotonic()
    next_telemetry = start
    try:
        while True:
            now = time.monotonic()
            if now >= next_telemetry:
                payload = build_telemetry_payload(
                    sensors, last_values, int(now - start), runner.running_version
                )
                connection.publish(telemetry_topic, payload)
                print(f"-> {telemetry_topic}: {json.dumps(payload)}")
                next_telemetry = now + args.interval
            try:
                command, valid = commands.get(timeout=0.2)
            except queue.Empty:
                continue
            outcome = runner.handle(command, valid)
            print(f"Actualización {command.request_id}: {outcome}. Versión actual: {runner.running_version}")
            next_telemetry = time.monotonic()  # report the (maybe new) version right away
    except KeyboardInterrupt:
        print("\nSaliendo...")
    finally:
        connection.close()
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Emula un dispositivo IoT publicando telemetría por mTLS.",
    )
    parser.add_argument("--serial", required=True, help="Serial del dispositivo (ej. IOT-DEM0-0001)")
    parser.add_argument(
        "--cert-dir",
        default=None,
        help="Directorio con client.crt/client.key/root.crt (default: mqtt/pki/devices/<serial>/)",
    )
    parser.add_argument("--host", default="localhost", help="Host del broker (default: localhost)")
    parser.add_argument(
        "--port",
        type=int,
        default=18883,
        help="Puerto TLS publicado en el host por mqtt/docker-compose.yml (default: 18883)",
    )
    parser.add_argument("--interval", type=float, default=5.0, help="Segundos entre publicaciones (default: 5)")
    parser.add_argument("--count", type=int, default=1, help="Cantidad de lecturas a publicar (default: 1)")
    parser.add_argument(
        "--sensors",
        default="dht22:temperature,relative_humidity",
        help=(
            "Especificación de sensores instalados como "
            "'clave:variable1,variable2;clave2:variable3'. "
            "Default: 'dht22:temperature,relative_humidity'."
        ),
    )
    parser.add_argument(
        "--pedir-hora",
        action="store_true",
        help="Después de publicar, pide la hora por iot/devices/<serial>/time/request y espera la respuesta.",
    )
    parser.add_argument(
        "--firmware-version",
        default="emulador",
        help="Versión de firmware que reporta en la telemetría (default: 'emulador').",
    )
    ota = parser.add_argument_group("actualización OTA (--ota)")
    ota.add_argument(
        "--ota",
        action="store_true",
        help=(
            "Queda conectado como el equipo (client id = serial) publicando telemetría cada "
            "--interval segundos y atiende iot/devices/<serial>/ota/command como el firmware. "
            "Ctrl+C para salir; --count se ignora."
        ),
    )
    ota.add_argument(
        "--ota-url-base",
        default=None,
        help=(
            "Reemplaza esquema y host de la URL de descarga recibida (ej. http://localhost:18000) "
            "cuando FIRMWARE_DOWNLOAD_BASE_URL apunta a una IP o host no alcanzable desde donde corre el emulador."
        ),
    )
    ota.add_argument(
        "--ota-fail-at",
        choices=OTA_FAIL_POINTS,
        default=None,
        help=(
            "Simula una falla: 'downloading' corta la descarga a la mitad (error download_failed); "
            "'verifying' corrompe la imagen descargada (error sha256_mismatch). Nunca instala."
        ),
    )
    ota.add_argument(
        "--ota-disconnect-at",
        choices=OTA_DISCONNECT_POINTS,
        default=None,
        help=(
            "Corta la conexión MQTT de golpe a mitad de la descarga (el broker publica el LWT offline "
            "y el backend marca el intento como 'interrupted'); reconecta a los 5s con la versión anterior."
        ),
    )
    ota.add_argument(
        "--ota-step-delay",
        type=float,
        default=1.0,
        help="Segundos de pausa entre estados y pasos de progreso, para verlos en la web (default: 1).",
    )
    args = parser.parse_args(argv)
    ota_only = ("ota_url_base", "ota_fail_at", "ota_disconnect_at")
    if not args.ota and any(getattr(args, name) is not None for name in ota_only):
        parser.error("--ota-url-base, --ota-fail-at y --ota-disconnect-at requieren --ota.")
    if args.ota_fail_at and args.ota_disconnect_at:
        parser.error("--ota-fail-at y --ota-disconnect-at no se pueden combinar.")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return emulate_with_ota(args) if args.ota else emulate_telemetry(args)
    except (FileNotFoundError, ValueError, ConnectionError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
