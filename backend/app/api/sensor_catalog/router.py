"""Sensor catalogs, installed device sensors, and current-device telemetry."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.access.repository import GuestAccessRepository
from app.api.access.service import GuestAccessService
from app.api.auth.models import User
from app.api.sensor.models import Telemetry
from app.api.sensor.router import _resolve_access_start
from app.api.sensor_catalog.models import DeviceSensor, Sensor, SensorVariable, Variable
from app.api.sensor_catalog.permissions import SensorCatalogPermissions as Permissions
from app.api.sensor_catalog.schemas import (DeviceSensorCreate, DeviceSensorPatch, DeviceSensorRead, next_sensor_key,
    SensorRead, SensorVariableRead, VariableRead)
from app.api.sensor_catalog.telemetry import TelemetryPage, sensor_descriptions
from app.core.dependencies import AuthedAsyncDBSession, PermissionChecker, get_current_user

catalog_router = APIRouter()
device_router = APIRouter()


@catalog_router.get('/variables', response_model=list[VariableRead],
            dependencies=[Depends(PermissionChecker(Permissions.READ))])
async def list_variables(session: AuthedAsyncDBSession):
    return (await session.execute(select(Variable).where(Variable.is_active.is_(True))
                                  .order_by(Variable.code))).scalars().all()


@catalog_router.get('/sensors', response_model=list[SensorRead],
            dependencies=[Depends(PermissionChecker(Permissions.READ))])
async def list_sensors(session: AuthedAsyncDBSession):
    sensors = (await session.execute(select(Sensor).where(Sensor.is_active.is_(True))
                                  .order_by(Sensor.code))).scalars().all()
    if not sensors:
        return []
    rows = (await session.execute(select(SensorVariable, Variable)
        .join(Variable, Variable.id == SensorVariable.variable_id)
        .where(SensorVariable.sensor_id.in_([sensor.id for sensor in sensors]))
        .order_by(Variable.code))).all()
    by_sensor = {sensor.id: [] for sensor in sensors}
    for association, variable in rows:
        by_sensor[association.sensor_id].append(SensorVariableRead(
            code=variable.code, name=variable.name, unit=variable.unit,
            min=association.min_value, max=association.max_value,
            accuracy=association.accuracy, resolution=association.resolution))
    return [SensorRead(id=sensor.id, code=sensor.code, name=sensor.name,
        manufacturer=sensor.manufacturer, variables=by_sensor[sensor.id]) for sensor in sensors]


async def _authorize(device_id: uuid.UUID, session: AuthedAsyncDBSession,
                     user: User, *, write: bool = False):
    context = await GuestAccessService(GuestAccessRepository(session)).resolve_device_access(
        device_id, user)
    if write and not (user.is_admin or context.is_owner):
        raise HTTPException(403, 'Only the owner or an administrator can manage device sensors')
    return context


async def _installed(session, device_id):
    rows = (await session.execute(select(DeviceSensor).where(DeviceSensor.device_id == device_id)
        .order_by(DeviceSensor.key))).scalars().all()
    return rows


@device_router.get('/{device_id}/sensors', response_model=list[DeviceSensorRead],
            dependencies=[Depends(PermissionChecker(Permissions.DEVICE_READ))])
async def list_device_sensors(device_id: uuid.UUID, session: AuthedAsyncDBSession,
                              current_user: User = Depends(get_current_user)):
    await _resolve_access_start(device_id, session, current_user)
    return await _installed(session, device_id)


@device_router.post('/{device_id}/sensors', response_model=DeviceSensorRead, status_code=201,
             dependencies=[Depends(PermissionChecker(Permissions.DEVICE_WRITE))])
async def create_device_sensor(device_id: uuid.UUID, body: DeviceSensorCreate,
                               session: AuthedAsyncDBSession,
                               current_user: User = Depends(get_current_user)):
    await _authorize(device_id, session, current_user, write=True)
    sensor = await session.get(Sensor, body.sensor_id)
    if sensor is None or not sensor.is_active:
        raise HTTPException(404, 'Sensor model not found')
    keys = {row.key for row in await _installed(session, device_id)}
    key = body.key if body.key is not None else next_sensor_key(sensor.code, keys)
    if key in keys:
        raise HTTPException(409, 'Sensor key already exists on this device')
    row = DeviceSensor(device_id=device_id, sensor_id=sensor.id, key=key, config=body.config)
    session.add(row)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, 'Sensor key already exists on this device') from None
    await session.refresh(row)
    return row


@device_router.patch('/{device_id}/sensors/{id}', response_model=DeviceSensorRead,
              dependencies=[Depends(PermissionChecker(Permissions.DEVICE_WRITE))])
async def patch_device_sensor(device_id: uuid.UUID, id: uuid.UUID, body: DeviceSensorPatch,
                              session: AuthedAsyncDBSession,
                              current_user: User = Depends(get_current_user)):
    await _authorize(device_id, session, current_user, write=True)
    row = await session.get(DeviceSensor, id)
    if row is None or row.device_id != device_id:
        raise HTTPException(404, 'Device sensor not found')
    changes = body.model_dump(exclude_unset=True)
    if changes.get('key') is None and 'key' in changes:
        raise HTTPException(422, 'key cannot be null')
    if changes.get('config') is None and 'config' in changes:
        raise HTTPException(422, 'config cannot be null')
    if changes.get('is_active') is None and 'is_active' in changes:
        raise HTTPException(422, 'isActive cannot be null')
    if 'key' in changes and changes['key'] != row.key:
        if changes['key'] in {other.key for other in await _installed(session, device_id)}:
            raise HTTPException(409, 'Sensor key already exists on this device')
    old_key = row.key if 'key' in changes and changes['key'] != row.key else None
    old_config = dict(row.config)
    old_installed_at = row.installed_at
    for field, value in changes.items():
        setattr(row, field, value)
    if 'is_active' in changes:
        row.removed_at = None if row.is_active else datetime.now(UTC)
    try:
        if old_key is not None:
            # Keep the prior key/model mapping for already-stored JSONB rows.
            # The full UNIQUE(device_id,key) constraint requires flushing the
            # renamed live row before inserting this inactive historical alias.
            await session.flush()
            session.add(DeviceSensor(device_id=device_id, sensor_id=row.sensor_id,
                key=old_key, config=old_config, is_active=False,
                installed_at=old_installed_at, removed_at=datetime.now(UTC)))
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, 'Sensor key already exists on this device') from None
    await session.refresh(row)
    return row


@device_router.delete('/{device_id}/sensors/{id}', response_model=DeviceSensorRead,
               dependencies=[Depends(PermissionChecker(Permissions.DEVICE_WRITE))])
async def deactivate_device_sensor(device_id: uuid.UUID, id: uuid.UUID,
                                   session: AuthedAsyncDBSession,
                                   current_user: User = Depends(get_current_user)):
    return await patch_device_sensor(device_id, id, DeviceSensorPatch(is_active=False),
                                     session, current_user)


@device_router.get('/{device_id}/telemetry/latest', response_model=TelemetryPage,
            response_model_exclude_none=True,
            dependencies=[Depends(PermissionChecker(Permissions.TELEMETRY_READ))])
async def latest_telemetry(device_id: uuid.UUID, session: AuthedAsyncDBSession,
                           current_user: User = Depends(get_current_user),
                           limit: int = Query(10, ge=1, le=1000)):
    start = await _resolve_access_start(device_id, session, current_user)
    predicate = [Telemetry.device_id == device_id]
    if start is not None:
        predicate.append(Telemetry.time >= start)
    rows = (await session.execute(select(Telemetry).where(*predicate)
        .order_by(Telemetry.time.desc(), Telemetry.id.desc()).limit(limit))).scalars().all()
    total = (await session.execute(select(func.count()).select_from(Telemetry)
        .where(*predicate))).scalar_one()
    return TelemetryPage(items=rows, total=total,
        sensors=await sensor_descriptions(session, rows, {device_id}))


@device_router.get('/{device_id}/telemetry/history', response_model=TelemetryPage,
            dependencies=[Depends(PermissionChecker(Permissions.TELEMETRY_READ))])
async def telemetry_history(device_id: uuid.UUID, session: AuthedAsyncDBSession,
                            current_user: User = Depends(get_current_user),
                            start: datetime = Query(...), end: datetime = Query(...),
                            page: int = Query(1, ge=1), per_page: int = Query(100, ge=1, le=10000)):
    access_start = await _resolve_access_start(device_id, session, current_user)
    start = start.astimezone(UTC) if start.tzinfo else start.replace(tzinfo=UTC)
    end = end.astimezone(UTC) if end.tzinfo else end.replace(tzinfo=UTC)
    if start > end:
        raise HTTPException(422, 'start must be less than or equal to end')
    if access_start is not None:
        start = max(start, access_start.replace(tzinfo=UTC))
    predicates = [Telemetry.device_id == device_id, Telemetry.time >= start, Telemetry.time <= end]
    total = (await session.execute(select(func.count()).select_from(Telemetry)
        .where(*predicates))).scalar_one()
    rows = (await session.execute(select(Telemetry).where(*predicates)
        .order_by(Telemetry.time.desc(), Telemetry.id.desc())
        .offset((page - 1) * per_page).limit(per_page))).scalars().all()
    return TelemetryPage(items=rows, total=total, page=page, per_page=per_page,
        pages=(total + per_page - 1) // per_page,
        sensors=await sensor_descriptions(session, rows, {device_id}))
