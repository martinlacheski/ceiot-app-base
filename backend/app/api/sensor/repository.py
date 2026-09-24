from sqlmodel.ext.asyncio.session import AsyncSession
import uuid

from sqlalchemy import select
from app.api.sensor.models import SensorReading, Telemetry
from app.api.sensor_catalog.models import DeviceSensor, Sensor, SensorVariable, Variable


class SensorRepository:
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def create(self, reading: SensorReading) -> SensorReading:
        """Crea una nueva lectura de sensor"""
        self.session.add(reading)
        await self.session.commit()
        return reading

    async def get_active_sensor_capabilities(
        self, device_id: uuid.UUID
    ) -> list[tuple[str, str, float, float]]:
        """Load installed sensor keys and their per-model variable ranges in one query."""
        result = await self.session.execute(
            select(
                DeviceSensor.key,
                Variable.code,
                SensorVariable.min_value,
                SensorVariable.max_value,
            )
            .join(Sensor, Sensor.id == DeviceSensor.sensor_id)
            .join(SensorVariable, SensorVariable.sensor_id == Sensor.id)
            .join(Variable, Variable.id == SensorVariable.variable_id)
            .where(
                DeviceSensor.device_id == device_id,
                DeviceSensor.is_active.is_(True),
                DeviceSensor.removed_at.is_(None),
            )
        )
        return [(key, code, minimum, maximum) for key, code, minimum, maximum in result.all()]

    async def create_telemetry(self, telemetry: Telemetry) -> Telemetry:
        self.session.add(telemetry)
        await self.session.commit()
        return telemetry
