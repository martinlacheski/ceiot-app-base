"""Telemetry projections shared by current-device and serial-history APIs."""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.sensor_catalog.models import DeviceSensor, Sensor, SensorVariable, Variable
from app.core.utils import CamelModel


class TelemetryItem(CamelModel):
    time: datetime
    values: dict


class TelemetryVariable(CamelModel):
    code: str
    name: str
    unit: str


class TelemetrySensor(CamelModel):
    key: str
    sensor_code: str
    sensor_name: str
    variables: list[TelemetryVariable]


class TelemetryPage(CamelModel):
    items: list[TelemetryItem]
    total: int
    sensors: list[TelemetrySensor]
    page: int | None = None
    per_page: int | None = None
    pages: int | None = None


async def sensor_descriptions(session: AsyncSession, items: list, device_ids: set[uuid.UUID]) -> list[TelemetrySensor]:
    """Describe only keys present in returned values; include deactivated sensors."""
    keys = {key for item in items for key in item.values}
    if not keys or not device_ids:
        return []
    rows = (await session.execute(select(DeviceSensor.key, Sensor.code, Sensor.name,
        Variable.code, Variable.name, Variable.unit).join(Sensor, Sensor.id == DeviceSensor.sensor_id)
        .join(SensorVariable, SensorVariable.sensor_id == Sensor.id)
        .join(Variable, Variable.id == SensorVariable.variable_id)
        .where(DeviceSensor.device_id.in_(device_ids), DeviceSensor.key.in_(keys))
        .order_by(DeviceSensor.key, Variable.code))).all()
    descriptions = {}
    for key, sensor_code, sensor_name, code, name, unit in rows:
        identity = (key, sensor_code)
        entry = descriptions.setdefault(identity, TelemetrySensor(key=key, sensor_code=sensor_code,
            sensor_name=sensor_name, variables=[]))
        variable = TelemetryVariable(code=code, name=name, unit=unit)
        if variable not in entry.variables:
            entry.variables.append(variable)
    return list(descriptions.values())
