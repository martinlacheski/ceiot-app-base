from app.api.sensor.models import SensorReading, Telemetry
from app.api.sensor.repository import SensorRepository
from typing import Optional, Dict, Any
import logging
import math
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)


def _finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def validate_sensor_values(
    sensors: Any,
    capabilities: list[tuple[str, str, float, float]],
) -> dict[str, dict[str, int | float]]:
    """Discard invalid keys/measurements without losing valid sibling values."""
    if not isinstance(sensors, dict):
        logger.warning("Invalid sensors payload: expected an object")
        return {}

    allowed: dict[str, dict[str, tuple[float, float]]] = {}
    for key, code, minimum, maximum in capabilities:
        allowed.setdefault(key, {})[code] = (minimum, maximum)

    valid: dict[str, dict[str, int | float]] = {}
    for key, measurements in sensors.items():
        if key not in allowed:
            logger.warning("Unknown or inactive device sensor key %r; dropping key", key)
            continue
        if not isinstance(measurements, dict):
            logger.warning("Invalid measurements for sensor key %r: expected an object", key)
            continue
        accepted: dict[str, int | float] = {}
        for code, value in measurements.items():
            limits = allowed[key].get(code)
            if limits is None:
                logger.warning("Sensor key %r does not measure variable %r; dropping value", key, code)
            elif not _finite_number(value):
                logger.warning("Invalid value for sensor key %r variable %r: %r; dropping value", key, code, value)
            elif not limits[0] <= value <= limits[1]:
                logger.warning("Out-of-range value for sensor key %r variable %r: %r; allowed [%s, %s]", key, code, value, *limits)
            else:
                accepted[code] = value
        if accepted:
            valid[key] = accepted
    return valid


class SensorService:
    def __init__(self, repository: SensorRepository):
        self.repository = repository

    async def save_sensor_telemetry(
        self,
        *,
        device_id: uuid.UUID | None,
        device_serial: str,
        sensors: Any,
        time: datetime | None = None,
    ) -> Telemetry | None:
        if device_id is None:
            logger.warning("Cannot ingest sensor telemetry for unknown device %r", device_serial)
            return None
        capabilities = await self.repository.get_active_sensor_capabilities(device_id)
        values = validate_sensor_values(sensors, capabilities)
        if not values:
            return None
        telemetry = Telemetry(
            device_id=device_id,
            device_serial=device_serial,
            values=values,
            **({"time": time} if time is not None else {}),
        )
        return await self.repository.create_telemetry(telemetry)
    
    async def save_reading(
        self,
        device_serial: str,
        device_id: Optional[uuid.UUID] = None,
        power_supply_state: Optional[bool] = None,
        # Telemetria
        uptime: Optional[int] = None,
        firmware_version: Optional[str] = None,
        reset_reason: Optional[str] = None,
        heap_free: Optional[int] = None,
        wifi_rssi: Optional[int] = None,
        wifi_ssid: Optional[str] = None,
        wifi_ip: Optional[str] = None,
        last_error: Optional[str] = None,
        # Metadata
        device_type: str = "generic",
        device_datetime: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> SensorReading:
        """
        Guarda una lectura de salud del dispositivo (sin mediciones ambientales:
        esas viven únicamente en `telemetry`, ver save_sensor_telemetry).
        """
        reading = SensorReading(
            device_serial=device_serial,
            device_id=device_id,
            power_supply_state=power_supply_state,
            device_type=device_type,
            device_datetime=device_datetime,
            uptime=uptime,
            firmware_version=firmware_version,
            reset_reason=reset_reason,
            heap_free=heap_free,
            wifi_rssi=wifi_rssi,
            wifi_ssid=wifi_ssid,
            wifi_ip=wifi_ip,
            last_error=last_error,
            extra_data=metadata
        )

        logger.info("📊 Guardando telemetría del dispositivo: %s", device_serial)

        return await self.repository.create(reading)
