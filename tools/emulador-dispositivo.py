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

Ver la sección "CLI de emulación" en mqtt/README.md para más ejemplos y
para correrlo con el certificado montado dentro del contenedor backend.
"""

from __future__ import annotations

import argparse
import json
import random
import ssl
import sys
import time
import uuid
from pathlib import Path

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
        "firmware_version": "emulador",
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


def build_client(serial: str, host: str, ca: Path, cert: Path, key: Path) -> "mqtt.Client":
    client = mqtt.Client(client_id=f"emulador-{serial}-{uuid.uuid4().hex[:8]}")
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
            payload = build_telemetry_payload(sensors, last_values, uptime)
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
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return emulate_telemetry(args)
    except (FileNotFoundError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
