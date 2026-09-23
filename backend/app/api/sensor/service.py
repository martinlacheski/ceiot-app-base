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


def _validate_environmental_value(
    name: str,
    value: Any,
    minimum: float,
    maximum: float,
) -> Optional[float]:
    if value is None:
        return None

    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not minimum <= value <= maximum
        or not math.isfinite(value)
    ):
        logger.warning(
            "Invalid environmental measurement %s=%r; persisting null",
            name,
            value,
        )
        return None

    return float(value)


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
        temperature_c: Optional[float] = None,
        relative_humidity_pct: Optional[float] = None,
        pressure_hpa: Optional[float] = None,
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
        Guarda una lectura de sensor.
        """
        temperature_c = _validate_environmental_value(
            "temperature_c", temperature_c, -40.0, 85.0
        )
        relative_humidity_pct = _validate_environmental_value(
            "relative_humidity_pct", relative_humidity_pct, 0.0, 100.0
        )
        pressure_hpa = _validate_environmental_value(
            "pressure_hpa", pressure_hpa, 300.0, 1100.0
        )

        reading = SensorReading(
            device_serial=device_serial,
            device_id=device_id,
            power_supply_state=power_supply_state,
            temperature_c=temperature_c,
            relative_humidity_pct=relative_humidity_pct,
            pressure_hpa=pressure_hpa,
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
    
    async def get_latest_readings(
        self, 
        device_serial: str, 
        limit: int = 10
    ) -> list[SensorReading]:
        """Obtiene las últimas lecturas de un dispositivo"""
        return await self.repository.get_latest_by_device(device_serial, limit)
    
    async def get_recent_readings(
        self, 
        device_serial: str, 
        hours: int = 24
    ) -> list[SensorReading]:
        """Obtiene lecturas recientes"""
        return await self.repository.get_recent_readings(device_serial, hours)

    async def get_latest_readings_by_device_id(
        self,
        device_id: uuid.UUID,
        limit: int = 10,
        start_time: Optional[datetime] = None,
    ) -> tuple[list[SensorReading], int]:
        """Return the latest readings for an authorized device UUID."""
        return await self.repository.get_latest_by_device_id(
            device_id=device_id,
            limit=limit,
            start_time=start_time,
        )

    async def get_readings_by_device_id_and_range(
        self,
        device_id: uuid.UUID,
        start_time: datetime,
        end_time: datetime,
    ) -> list[SensorReading]:
        """Return readings for an authorized device UUID and time range."""
        return await self.repository.get_readings_by_device_id_and_range(
            device_id=device_id,
            start_time=start_time,
            end_time=end_time,
        )
