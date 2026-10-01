"""Telemetry projections shared by current-device and serial-history APIs."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Literal

from sqlalchemy import select, text
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


class LiveTelemetry(CamelModel):
    """Latest known state of a device, from Redis when present or the database."""

    source: Literal["redis", "database"]
    time: datetime | None = None
    values: dict
    # Last health fields the device reported (uptime, firmware_version, wifi_rssi, ...).
    health: dict = {}
    # Broker presence last seen by the runtime ("online"/"offline"), Redis only.
    presence: str | None = None
    sensors: list[TelemetrySensor]


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


class DailyStat(CamelModel):
    min: float
    max: float
    avg: float
    count: int


class DailyTelemetryDay(CamelModel):
    date: str
    sensors: dict[str, dict[str, DailyStat]]


class DailyTelemetry(CamelModel):
    days: list[DailyTelemetryDay]
    sensors: list[TelemetrySensor]


# PostgreSQL-only: expands the JSONB values object (sensor key -> variable -> number).
# CASE guards keep malformed rows (non-object sensors, non-numeric readings) from failing the query.
_DAILY_SQL = """
SELECT ((t.time AT TIME ZONE 'UTC') + CAST(:offset AS integer) * interval '1 minute')::date AS day,
       s.key AS sensor_key, v.key AS variable,
       min(CASE WHEN jsonb_typeof(v.value) = 'number' THEN (v.value #>> '{}')::numeric END) AS min_value,
       max(CASE WHEN jsonb_typeof(v.value) = 'number' THEN (v.value #>> '{}')::numeric END) AS max_value,
       avg(CASE WHEN jsonb_typeof(v.value) = 'number' THEN (v.value #>> '{}')::numeric END) AS avg_value,
       count(CASE WHEN jsonb_typeof(v.value) = 'number' THEN 1 END) AS readings
FROM telemetry t
CROSS JOIN LATERAL jsonb_each(t."values") AS s(key, value)
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(s.value) = 'object' THEN s.value ELSE '{}'::jsonb END)
    AS v(key, value)
WHERE t.device_id = :device_id AND t.time >= :start AND t.time <= :end@ACCESS@
GROUP BY 1, 2, 3
HAVING count(CASE WHEN jsonb_typeof(v.value) = 'number' THEN 1 END) > 0
ORDER BY 1, 2, 3
"""


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def daily_telemetry(session: AsyncSession, device_id: uuid.UUID, start: datetime, end: datetime,
                          utc_offset_minutes: int = 0, access_start: datetime | None = None) -> list[dict]:
    """Aggregate telemetry per local day (UTC + offset), sensor key and variable, in SQL."""
    params = {'device_id': device_id, 'start': _aware(start), 'end': _aware(end), 'offset': utc_offset_minutes}
    access = ''
    if access_start is not None:
        access = ' AND t.time >= :access_start'
        params['access_start'] = _aware(access_start)
    rows = (await session.execute(text(_DAILY_SQL.replace('@ACCESS@', access)), params)).all()
    days: dict[str, dict] = {}
    for day, sensor_key, variable, minimum, maximum, average, readings in rows:
        entry = days.setdefault(day.isoformat(), {'date': day.isoformat(), 'sensors': {}})
        entry['sensors'].setdefault(sensor_key, {})[variable] = {
            'min': float(minimum), 'max': float(maximum), 'avg': float(average), 'count': int(readings)}
    return list(days.values())


async def daily_sensor_descriptions(session: AsyncSession, days: list[dict], device_id: uuid.UUID):
    keys = {key: {} for day in days for key in day['sensors']}
    return await sensor_descriptions(session, [SimpleNamespace(values=keys)], {device_id})
