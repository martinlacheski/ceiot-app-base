"""Data-driven sensor rules of a device type (replaces the old hard-coded Ambiental rule)."""

import uuid
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Mapping, Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.device_type.models import DeviceTypeCatalog, DeviceTypeSensor
from app.api.sensor_catalog.models import DeviceSensor, Sensor


@dataclass(frozen=True)
class CompatibleSensor:
    sensor_id: uuid.UUID
    code: str
    name: str
    required: bool
    max_count: int
    included_by_default: bool


async def load_compatible(session: AsyncSession, type_id: uuid.UUID) -> dict[uuid.UUID, CompatibleSensor]:
    rows = (
        await session.exec(
            select(DeviceTypeSensor, Sensor)
            .join(Sensor, Sensor.id == DeviceTypeSensor.sensor_id)
            .where(DeviceTypeSensor.device_type_id == type_id)
        )
    ).all()
    return {
        link.sensor_id: CompatibleSensor(
            sensor_id=link.sensor_id,
            code=sensor.code,
            name=sensor.name,
            required=link.required,
            max_count=link.max_count,
            included_by_default=link.included_by_default,
        )
        for link, sensor in rows
    }


async def installed_counts(session: AsyncSession, device_id: uuid.UUID) -> Counter:
    """Active installations per sensor model of one device."""
    rows = (
        await session.exec(
            select(DeviceSensor.sensor_id).where(
                DeviceSensor.device_id == device_id, DeviceSensor.is_active.is_(True)
            )
        )
    ).all()
    return Counter(rows)


async def sensor_names(session: AsyncSession, sensor_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, str]:
    ids = list(set(sensor_ids))
    if not ids:
        return {}
    rows = (await session.exec(select(Sensor.id, Sensor.name).where(Sensor.id.in_(ids)))).all()
    return {sensor_id: name for sensor_id, name in rows}


def check_sensor_counts(
    device_type: DeviceTypeCatalog,
    compatible: Mapping[uuid.UUID, CompatibleSensor],
    counts: Mapping[uuid.UUID, int],
    names: Mapping[uuid.UUID, str],
    *,
    enforce_minimum: bool = False,
    action: str = "registrar el dispositivo",
) -> None:
    """Raise 422 when ``counts`` (sensor model -> installed units) breaks the type's rules.

    Compatibility and ``max_count`` always apply. ``min_sensors`` and ``required`` entries
    only apply to a manual registration (``enforce_minimum``): provisioning and pairing create
    sensorless devices on purpose and add the sensors later.
    """
    incompatible = sorted(names.get(sid, str(sid)) for sid, n in counts.items() if n and sid not in compatible)
    if incompatible:
        raise HTTPException(
            422,
            f"Al {action}, los sensores {', '.join(incompatible)} no son compatibles con el tipo «{device_type.name}»",
        )
    for sensor_id, number in counts.items():
        entry = compatible.get(sensor_id)
        if entry is not None and number > entry.max_count:
            raise HTTPException(
                422,
                f"El tipo «{device_type.name}» admite como máximo {entry.max_count} sensor(es) {entry.name}",
            )
    if not enforce_minimum:
        return
    total = sum(counts.values())
    if total < device_type.min_sensors:
        raise HTTPException(
            422,
            f"El tipo «{device_type.name}» requiere al menos {device_type.min_sensors} sensor(es)",
        )
    missing = sorted(entry.name for entry in compatible.values() if entry.required and not counts.get(entry.sensor_id))
    if missing:
        raise HTTPException(
            422,
            f"El tipo «{device_type.name}» requiere el sensor {', '.join(missing)}",
        )


async def check_new_installation(
    session: AsyncSession,
    device_type: Optional[DeviceTypeCatalog],
    device_id: uuid.UUID,
    sensor: Sensor,
) -> None:
    """Rule for adding (or re-activating) one sensor on an existing device."""
    if device_type is None:
        return
    counts = await installed_counts(session, device_id)
    counts[sensor.id] += 1
    compatible = await load_compatible(session, device_type.id)
    names = await sensor_names(session, counts.keys())
    check_sensor_counts(device_type, compatible, counts, names, action="agregar el sensor")
