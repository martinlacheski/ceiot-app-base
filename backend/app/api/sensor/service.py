from app.api.sensor.models import SensorReading
from app.api.sensor.repository import SensorRepository
from typing import Optional, Dict, Any
import logging
import math
import uuid

logger = logging.getLogger(__name__)


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
