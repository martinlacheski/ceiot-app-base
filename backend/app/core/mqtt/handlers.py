import json
import logging
from datetime import datetime, timezone

from app.api.device.operations.models import DeviceOperationStatus, DeviceOperationType
from app.api.device.operations.service import DeviceOperationService
from app.api.device.repository import DeviceRepository
from app.api.device.service import DeviceService
from app.core.db import system_session

logger = logging.getLogger(__name__)

_HEALTH_SIGNAL_KEYS = ("power_supply_state",)
# S6: environmental values now live only in the JSONB `telemetry` table (see
# app.api.sensor.service.SensorService.save_sensor_telemetry), keyed by
# installed device sensor via the `sensors` payload. These flat top-level
# keys are the pre-S1 device firmware contract; they are no longer persisted
# anywhere, but older/misconfigured firmware may still send them, so we keep
# recognizing them just to log a clear warning instead of silently dropping
# telemetry.
_LEGACY_ENVIRONMENTAL_KEYS = ("temperature", "humidity", "pressure")
_RUNTIME_HEALTH_KEYS = (
    "uptime",
    "firmware_version",
    "reset_reason",
    "heap_free",
    "wifi_rssi",
    "wifi_ssid",
    "wifi_ip",
    "last_error",
)
_RETIRED_COMMANDS = {"DISPENSE_ACK", "DISPENSE"}


def _clean_mac_address(value) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    return normalized or None


def _decode_payload(payload) -> str:
    if isinstance(payload, bytes):
        return payload.decode("utf-8", errors="ignore")
    if isinstance(payload, str):
        return payload
    return str(payload)


def _extract_serial_from_topic(topic: str) -> str | None:
    parts = topic.split("/")
    if len(parts) >= 3 and parts[0] == "iot" and parts[1] == "devices":
        return parts[2]
    return None


def _parse_broker_presence_payload(payload) -> bool | None:
    raw_payload = _decode_payload(payload).strip()
    if not raw_payload:
        return None

    normalized_payload = raw_payload.lower()
    if normalized_payload in {"online", '"online"'}:
        return True
    if normalized_payload in {"offline", '"offline"'}:
        return False

    try:
        data = json.loads(raw_payload)
    except json.JSONDecodeError:
        return None

    if isinstance(data, str):
        normalized_status = data.strip().lower()
        if normalized_status == "online":
            return True
        if normalized_status == "offline":
            return False
        return None

    if not isinstance(data, dict):
        return None

    for key in ("status", "connection", "state", "presence"):
        value = data.get(key)
        if isinstance(value, str):
            normalized_status = value.strip().lower()
            if normalized_status == "online":
                return True
            if normalized_status == "offline":
                return False

    connected = data.get("connected")
    if isinstance(connected, bool):
        return connected

    return None


def _coerce_float(value) -> float | None:
    if value is None or value == "":
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _is_valid_gps_coordinate(latitude: float, longitude: float) -> bool:
    return -90 <= latitude <= 90 and -180 <= longitude <= 180


def _parse_reported_at(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    if not normalized:
        return None

    try:
        parsed = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except ValueError:
        logger.warning("⚠️ Timestamp GPS inválido recibido: %s", value)
        return None


def _extract_gps_report(data: dict) -> tuple[float, float, datetime | None] | None:
    candidates = []
    gps = data.get("gps")
    if isinstance(gps, dict):
        candidates.append(
            (
                gps.get("latitude"),
                gps.get("longitude"),
                gps.get("timestamp"),
            )
        )

    candidates.extend(
        [
            (data.get("gps_latitude"), data.get("gps_longitude"), data.get("gps_timestamp")),
            (data.get("latitude"), data.get("longitude"), data.get("timestamp")),
        ]
    )

    for latitude_raw, longitude_raw, timestamp_raw in candidates:
        latitude = _coerce_float(latitude_raw)
        longitude = _coerce_float(longitude_raw)
        if latitude is None or longitude is None:
            continue
        if not _is_valid_gps_coordinate(latitude, longitude):
            logger.warning(
                "⚠️ Coordenadas GPS inválidas recibidas: lat=%s lon=%s",
                latitude,
                longitude,
            )
            continue
        return latitude, longitude, _parse_reported_at(timestamp_raw)

    return None


async def _persist_device_runtime_report(repo: DeviceRepository, device, data: dict) -> None:
    gps_report = _extract_gps_report(data)
    rssi = data.get("wifi_rssi")
    if rssi is None:
        rssi = data.get("rssi")
    await repo.register_runtime_report(
        device,
        mac_address=_clean_mac_address(data.get("mac_address")),
        firmware_version=data.get("firmware_version"),
        ip_address=data.get("wifi_ip") or data.get("ip_address"),
        rssi=rssi,
        wifi_ssid=data.get("wifi_ssid"),
        last_reset_reason=data.get("reset_reason") or data.get("last_reset_reason"),
        gps_latitude=gps_report[0] if gps_report else None,
        gps_longitude=gps_report[1] if gps_report else None,
        gps_updated_at=gps_report[2] if gps_report else None,
        touch_last_connection=True,
    )


async def process_sensor_message_pub(topic: str, payload: str):
    """
    Procesa mensajes de sensores (Publicaciones de estado, etc)
    Topic: iot/devices/{serial}/telemetry
    """
    try:
        data = json.loads(payload)
        logger.info(f"💾 Datos de sensor recibidos: {data}")

        if data.get("command") in _RETIRED_COMMANDS:
            logger.info(f"🛑 Comando retirado ignorado: {data.get('command')}")
            return

        async with system_session() as session:
            repo = DeviceRepository(session)
            op_service = DeviceOperationService(session)

            serial = topic.split("/")[2] if topic.startswith("iot/devices/") else data.get("serial")
            device = None
            if serial:
                device = await repo.get_by_serial(serial)
                if device:
                    await _persist_device_runtime_report(repo, device, data)

            has_sensor_data = "sensors" in data
            has_legacy_environmental_keys = any(key in data for key in _LEGACY_ENVIRONMENTAL_KEYS)
            if has_legacy_environmental_keys and not has_sensor_data:
                logger.warning(
                    "⚠️ Claves ambientales planas (temperature/humidity/pressure) ya no se "
                    "almacenan; serial=%r debe publicar un payload 'sensors'. Ignorando valores.",
                    serial,
                )
            op_type = (
                DeviceOperationType.SENSOR_DATA
                if has_sensor_data
                else DeviceOperationType.KEEP_ACTIVE
            )

            # Guardar operación
            await op_service.create_operation(
                operation_type=op_type,  # SQLAlchemy manejará esto
                device_serial=serial,
                status=DeviceOperationStatus.SUCCESS,
            )

            # Toda telemetría reconocida (salud, ambiental legacy o 'sensors')
            # genera una lectura de salud, con nulls honestos en los campos
            # de salud que no vinieron en el payload.
            if (
                has_sensor_data
                or has_legacy_environmental_keys
                or any(key in data for key in _HEALTH_SIGNAL_KEYS)
                or any(key in data for key in _RUNTIME_HEALTH_KEYS)
            ):
                from app.api.sensor.repository import SensorRepository
                from app.api.sensor.service import SensorService

                sensor_repo = SensorRepository(session)
                sensor_service = SensorService(sensor_repo)

                reading = await sensor_service.save_reading(
                    device_serial=serial,
                    device_id=device.id if device else None,
                    power_supply_state=data.get("power_supply_state"),
                    device_type=data.get("device_type", "generic"),
                    device_datetime=data.get("datetime"),
                    # Telemetría
                    uptime=data.get("uptime"),
                    firmware_version=data.get("firmware_version"),
                    reset_reason=data.get("reset_reason"),
                    heap_free=data.get("heap_free"),
                    wifi_rssi=data.get("wifi_rssi"),
                    wifi_ssid=data.get("wifi_ssid"),
                    wifi_ip=data.get("wifi_ip"),
                    last_error=data.get("last_error"),
                    metadata={
                        k: v
                        for k, v in data.items()
                        if k
                        not in [
                            "serial",
                            "power_supply_state",
                            "temperature",
                            "humidity",
                            "pressure",
                            "device_type",
                            "datetime",
                            "uptime",
                            "firmware_version",
                            "reset_reason",
                            "heap_free",
                            "wifi_rssi",
                            "wifi_ssid",
                            "wifi_ip",
                            "last_error",
                            "command",
                            "status",
                            "sensors",
                        ]
                    },
                )
                logger.info(f"📊 Lectura de sensor guardada: {serial}")

                if "sensors" in data:
                    try:
                        await sensor_service.save_sensor_telemetry(
                            device_id=device.id if device else None,
                            device_serial=serial,
                            sensors=data["sensors"],
                            time=reading.time,
                        )
                    except Exception:
                        logger.exception("Failed to ingest sensor-key telemetry for device %r", serial)

    except Exception as e:
        logger.error(f"❌ Error al procesar sensor pub: {e}")


async def process_sensor_message_sub(topic: str, payload: str):
    """
    Procesa mensajes del canal sub (Acknowledgements, Command responses)
    Topic: iot/devices/{serial}/events
    """
    try:
        logger.info(f"📥 [SUB] Mensaje recibido topic={topic}: {payload}")
        # Could also log this as "Response" from device if we can correlate it
    except Exception as e:
        logger.error(f"❌ Error al procesar sensor sub: {e}")


async def process_device_status_message(topic: str, payload: str):
    """
    Procesa presencia del broker.
    Topic: iot/devices/{serial}/status
    Payload esperado: online/offline o JSON equivalente.
    """
    try:
        serial = _extract_serial_from_topic(topic)
        if not serial:
            logger.warning("⚠️ MQTT status ignorado por topic inválido: %s", topic)
            return

        broker_connected = _parse_broker_presence_payload(payload)
        if broker_connected is None:
            logger.warning(
                "⚠️ MQTT status ignorado por payload inválido serial=%s payload=%s",
                serial,
                _decode_payload(payload),
            )
            return

        async with system_session() as session:
            repo = DeviceRepository(session)
            device = await repo.update_broker_presence(serial, broker_connected)
            if not device:
                logger.info(
                    "ℹ️ MQTT status recibido para serial desconocido: %s",
                    DeviceService.normalize_serial(serial),
                )
                return

        logger.info(
            "🔌 Broker presence actualizada serial=%s connected=%s",
            DeviceService.normalize_serial(serial),
            broker_connected,
        )
    except Exception as e:
        logger.error(f"❌ Error al procesar broker status: {e}")
