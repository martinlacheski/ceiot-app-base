"""Serial identity comes from snapshot rows, never from the current device row.

Every history source (including the public.telemetry view) stores the serial
directly. A former owner cannot necessarily SELECT the current device row.
"""

from app.api.device.operations.models import DeviceOperation
from app.api.sensor.models import SensorReading, Telemetry

READING_SERIAL = SensorReading.device_serial
OPERATION_SERIAL = DeviceOperation.device_serial
TELEMETRY_SERIAL = Telemetry.device_serial
