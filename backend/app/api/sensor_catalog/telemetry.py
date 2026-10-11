"""Telemetry projections shared by current-device and serial-history APIs."""

import math
import uuid
from datetime import datetime, timedelta, timezone
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


async def _keyed_descriptions(session: AsyncSession, keys: set[str], device_id: uuid.UUID):
    return await sensor_descriptions(session, [SimpleNamespace(values=dict.fromkeys(keys))], {device_id})


async def daily_sensor_descriptions(session: AsyncSession, days: list[dict], device_id: uuid.UUID):
    return await _keyed_descriptions(session, {key for day in days for key in day['sensors']}, device_id)


# Standard aggregation levels, finest first, in seconds.
AGGREGATE_BUCKETS: dict[str, int] = {
    '1m': 60, '5m': 5 * 60, '15m': 15 * 60, '1h': 3600, '6h': 6 * 3600, '1d': 24 * 3600}
# Any Monday works as origin: only its time of day (local midnight) matters for 1m..1d buckets.
_ORIGIN = datetime(2000, 1, 3, tzinfo=timezone.utc)


def resolve_bucket(bucket: str, span_seconds: float, max_points: int) -> str:
    """Explicit buckets are kept; ``auto`` is the finest one with at most ``max_points`` buckets."""
    if bucket != 'auto':
        return bucket
    for name, seconds in AGGREGATE_BUCKETS.items():
        if math.ceil(span_seconds / seconds) <= max_points:
            return name
    return '1d'


def bucket_origin(utc_offset_minutes: int) -> datetime:
    """UTC instant of a local midnight (local = UTC + offset), so buckets start at local hours."""
    return _ORIGIN - timedelta(minutes=utc_offset_minutes)


class AggregateStat(CamelModel):
    avg: float
    min: float
    max: float
    count: int


class AggregateItem(CamelModel):
    # Start of the bucket (UTC).
    time: datetime
    values: dict[str, dict[str, AggregateStat]]


class AggregateTelemetry(CamelModel):
    bucket: str
    bucket_seconds: int
    start: datetime
    end: datetime
    items: list[AggregateItem]
    sensors: list[TelemetrySensor]


# Same JSONB expansion and guards as the daily summary, grouped by TimescaleDB time buckets.
_AGGREGATE_SQL = """
SELECT time_bucket(CAST(:bucket_seconds AS integer) * interval '1 second', t.time,
                   CAST(:origin AS timestamptz)) AS bucket,
       s.key AS sensor_key, v.key AS variable,
       avg(CASE WHEN jsonb_typeof(v.value) = 'number' THEN (v.value #>> '{}')::numeric END) AS avg_value,
       min(CASE WHEN jsonb_typeof(v.value) = 'number' THEN (v.value #>> '{}')::numeric END) AS min_value,
       max(CASE WHEN jsonb_typeof(v.value) = 'number' THEN (v.value #>> '{}')::numeric END) AS max_value,
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


async def aggregate_telemetry(session: AsyncSession, device_id: uuid.UUID, start: datetime, end: datetime,
                              bucket_seconds: int, utc_offset_minutes: int = 0,
                              access_start: datetime | None = None) -> list[dict]:
    """avg/min/max/count per time bucket, sensor key and variable, ascending by bucket start."""
    params = {'device_id': device_id, 'start': _aware(start), 'end': _aware(end),
              'bucket_seconds': bucket_seconds, 'origin': bucket_origin(utc_offset_minutes)}
    access = ''
    if access_start is not None:
        access = ' AND t.time >= :access_start'
        params['access_start'] = _aware(access_start)
    rows = (await session.execute(text(_AGGREGATE_SQL.replace('@ACCESS@', access)), params)).all()
    buckets: dict[datetime, dict] = {}
    for bucket, sensor_key, variable, average, minimum, maximum, readings in rows:
        at = _aware(bucket).astimezone(timezone.utc)
        entry = buckets.setdefault(at, {'time': at, 'values': {}})
        entry['values'].setdefault(sensor_key, {})[variable] = {
            'avg': float(average), 'min': float(minimum), 'max': float(maximum), 'count': int(readings)}
    return list(buckets.values())


async def aggregate_sensor_descriptions(session: AsyncSession, items: list[dict], device_id: uuid.UUID):
    return await _keyed_descriptions(session, {key for item in items for key in item['values']}, device_id)
