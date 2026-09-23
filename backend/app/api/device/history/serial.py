"""Serial identity comes from snapshot rows, never from the current device row.

Both history tables store the serial directly. A former owner cannot
necessarily SELECT the current device row.
"""

from app.api.device.operations.models import DeviceOperation
from app.api.sensor.models import SensorReading

READING_SERIAL = SensorReading.device_serial
OPERATION_SERIAL = DeviceOperation.device_serial
