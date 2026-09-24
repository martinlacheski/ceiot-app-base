"""Sensor catalogs, installed device sensors, and current-device telemetry."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, delete, exists, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.api.access.repository import GuestAccessRepository
from app.api.access.service import GuestAccessService
from app.api.auth.models import User
from app.api.sensor.models import Telemetry
from app.api.sensor_catalog.models import DeviceSensor, Sensor, SensorVariable, Variable
from app.api.sensor_catalog.permissions import SensorCatalogPermissions as Permissions
from app.api.sensor_catalog.schemas import (DeviceSensorCreate, DeviceSensorPatch, DeviceSensorRead, next_sensor_key,
    SensorRead, SensorVariableRead, VariableRead, VariableAdminRead, VariableCreate, VariablePatch,
    SensorAdminRead, SensorAdminVariableRead, SensorCreate, SensorPatch)
from app.api.sensor_catalog.telemetry import TelemetryPage, sensor_descriptions
from app.core.dependencies import AuthedAsyncDBSession, PermissionChecker, get_current_user
from app.core.search import ILIKE_ESCAPE, ilike_pattern
from app.core.time import utc_now

catalog_router = APIRouter()
device_router = APIRouter()


def _admin_write(user: User = Depends(PermissionChecker(Permissions.WRITE))):
    if not user.is_admin:
        raise HTTPException(403, 'Only an administrator can manage the sensor catalog')
    return user


def _as_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


async def _resolve_access_start(
    device_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    current_user: User,
) -> datetime | None:
    """Guest-visible telemetry starts at their effective access grant (owners/admins see everything)."""
    access_service = GuestAccessService(GuestAccessRepository(session))
    context = await access_service.resolve_device_access(device_id, current_user)
    if current_user.is_admin or context.is_owner or not context.is_guest:
        return None

    access_starts_at = (
        await access_service.repository.get_effective_guest_access_start_for_device(
            device_id=device_id,
            environment_id=context.environment_id,
            guest_user_id=current_user.id,
        )
    )
    if access_starts_at is None:
        raise HTTPException(
            status_code=403,
            detail="No tienes acceso contextual a este dispositivo",
        )

    access_starts_at = _as_utc_naive(access_starts_at)
    if access_starts_at > utc_now():
        raise HTTPException(
            status_code=403,
            detail="El acceso a este dispositivo todavía no está vigente",
        )
    return access_starts_at


def _page(items, total: int, page: int, per_page: int):
    return {'items': items, 'total': total, 'page': page,
            'perPage': per_page, 'pages': (total + per_page - 1) // per_page}


def _state_search(column, search: str, pattern: str):
    label = search.strip()[:64].casefold()
    if label == 'activo':
        return column.is_(True)
    if label == 'inactivo':
        return column.is_(False)
    return case((column.is_(True), 'Activo'), else_='Inactivo').ilike(
        pattern, escape=ILIKE_ESCAPE)


def _sort(query, model, sort: str | None, allowed: set[str], extra=None):
    fields = []
    extra = extra or {}
    for part in (sort or 'code:asc').split(','):
        field, _, direction = part.partition(':')
        if field in allowed and direction.lower() in ('', 'asc', 'desc'):
            column = extra.get(field, getattr(model, field, None))
            expression = func.lower(column) if field not in {'is_active', 'variables'} else column
            ordered = expression.desc() if direction.lower() == 'desc' else expression.asc()
            fields.append(ordered.nulls_last())
    # Code first so equal rows keep a predictable order; id only guarantees uniqueness.
    return query.order_by(*fields, model.code.asc(), model.id.asc())


async def _sensor_admin(session, sensor: Sensor) -> SensorAdminRead:
    rows = (await session.execute(select(SensorVariable, Variable)
        .join(Variable, Variable.id == SensorVariable.variable_id)
        .where(SensorVariable.sensor_id == sensor.id).order_by(Variable.code))).all()
    return SensorAdminRead(id=sensor.id, code=sensor.code, name=sensor.name,
        manufacturer=sensor.manufacturer, description=sensor.description,
        is_active=sensor.is_active, variables=[SensorAdminVariableRead(
            variable_id=variable.id, code=variable.code, name=variable.name, unit=variable.unit,
            min_value=link.min_value, max_value=link.max_value,
            accuracy=link.accuracy, resolution=link.resolution) for link, variable in rows])


async def _replace_sensor_variables(session, sensor_id, variables):
    ids = [item.variable_id for item in variables]
    found = set((await session.execute(select(Variable.id).where(Variable.id.in_(ids)))).scalars().all()) if ids else set()
    if len(found) != len(ids):
        raise HTTPException(422, 'Unknown variableId')
    await session.execute(delete(SensorVariable).where(SensorVariable.sensor_id == sensor_id))
    session.add_all([SensorVariable(sensor_id=sensor_id, variable_id=item.variable_id,
        min_value=item.min_value, max_value=item.max_value,
        accuracy=item.accuracy, resolution=item.resolution) for item in variables])


@catalog_router.get('/variables', response_model=None,
            dependencies=[Depends(PermissionChecker(Permissions.READ))])
async def list_variables(session: AuthedAsyncDBSession,
                         page: int | None = Query(None, ge=1),
                         per_page: int = Query(10, ge=1, le=10000),
                         is_active: bool | None = Query(None), search: str | None = None,
                         unit: str | None = None,
                         sort: str | None = None):
    if page is None:
        rows = (await session.execute(select(Variable).where(Variable.is_active.is_(True))
                                      .order_by(Variable.code))).scalars().all()
        return [VariableRead.model_validate(row) for row in rows]
    query = select(Variable)
    if is_active is not None:
        query = query.where(Variable.is_active.is_(is_active))
    if unit:
        query = query.where(Variable.unit == unit)
    pattern = ilike_pattern(search)
    if pattern is not None:
        query = query.where(or_(Variable.code.ilike(pattern, escape=ILIKE_ESCAPE),
                                Variable.name.ilike(pattern, escape=ILIKE_ESCAPE),
                                Variable.unit.ilike(pattern, escape=ILIKE_ESCAPE),
                                Variable.description.ilike(pattern, escape=ILIKE_ESCAPE),
                                _state_search(Variable.is_active, search, pattern)))
    total = (await session.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = (await session.execute(_sort(query, Variable, sort,
        {'code', 'name', 'unit', 'is_active'}).offset((page - 1) * per_page).limit(per_page))).scalars().all()
    return _page([VariableAdminRead.model_validate(row) for row in rows], total, page, per_page)


@catalog_router.get('/sensors', response_model=None,
            dependencies=[Depends(PermissionChecker(Permissions.READ))])
async def list_sensors(session: AuthedAsyncDBSession,
                       page: int | None = Query(None, ge=1),
                       per_page: int = Query(10, ge=1, le=10000),
                       is_active: bool | None = Query(None), search: str | None = None,
                       manufacturer: str | None = None, variable_id: uuid.UUID | None = None,
                       sort: str | None = None):
    query = select(Sensor)
    if page is None or is_active is not None:
        query = query.where(Sensor.is_active.is_(True if page is None else is_active))
    if page is not None:
        if manufacturer:
            query = query.where(Sensor.manufacturer == manufacturer)
        if variable_id:
            query = query.where(exists(select(SensorVariable.sensor_id).where(
                SensorVariable.sensor_id == Sensor.id,
                SensorVariable.variable_id == variable_id)))
        pattern = ilike_pattern(search)
        if pattern is not None:
            query = query.where(or_(Sensor.code.ilike(pattern, escape=ILIKE_ESCAPE),
                Sensor.name.ilike(pattern, escape=ILIKE_ESCAPE),
                Sensor.manufacturer.ilike(pattern, escape=ILIKE_ESCAPE),
                _state_search(Sensor.is_active, search, pattern),
                exists(select(SensorVariable.sensor_id).join(Variable,
                    Variable.id == SensorVariable.variable_id).where(
                    SensorVariable.sensor_id == Sensor.id,
                    Variable.name.ilike(pattern, escape=ILIKE_ESCAPE)))))
        total = (await session.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
        # nullif turns "no variables" into NULL so NULLS LAST keeps those sensors at the end.
        variable_count = func.nullif((select(func.count(SensorVariable.variable_id)).where(
            SensorVariable.sensor_id == Sensor.id).correlate(Sensor).scalar_subquery()), 0)
        sensors = (await session.execute(_sort(query, Sensor, sort,
            {'code', 'name', 'manufacturer', 'variables', 'is_active'},
            {'variables': variable_count}).offset((page - 1) * per_page)
            .limit(per_page))).scalars().all()
        return _page([await _sensor_admin(session, sensor) for sensor in sensors], total, page, per_page)
    sensors = (await session.execute(query.order_by(Sensor.code))).scalars().all()
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


@catalog_router.get('/variables/{id}', response_model=VariableAdminRead,
            dependencies=[Depends(PermissionChecker(Permissions.READ))])
async def get_variable(id: uuid.UUID, session: AuthedAsyncDBSession):
    row = await session.get(Variable, id)
    if row is None:
        raise HTTPException(404, 'Variable not found')
    return row


@catalog_router.post('/variables', response_model=VariableAdminRead, status_code=201,
            dependencies=[Depends(_admin_write)])
async def create_variable(body: VariableCreate, session: AuthedAsyncDBSession):
    row = Variable(**body.model_dump())
    session.add(row)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, 'Variable code already exists') from None
    await session.refresh(row)
    return row


@catalog_router.patch('/variables/{id}', response_model=VariableAdminRead,
            dependencies=[Depends(_admin_write)])
async def patch_variable(id: uuid.UUID, body: VariablePatch, session: AuthedAsyncDBSession):
    row = await session.get(Variable, id)
    if row is None:
        raise HTTPException(404, 'Variable not found')
    changes = body.model_dump(exclude_unset=True)
    if 'code' in changes:
        raise HTTPException(409, 'Variable code is immutable')
    if any(value is None for key, value in changes.items() if key != 'description'):
        raise HTTPException(422, 'Required fields cannot be null')
    for key, value in changes.items():
        setattr(row, key, value)
    await session.commit()
    await session.refresh(row)
    return row


@catalog_router.delete('/variables/{id}', response_model=VariableAdminRead,
            dependencies=[Depends(_admin_write)])
async def deactivate_variable(id: uuid.UUID, session: AuthedAsyncDBSession):
    return await patch_variable(id, VariablePatch(is_active=False), session)


@catalog_router.get('/sensors/{id}', response_model=SensorAdminRead,
            dependencies=[Depends(PermissionChecker(Permissions.READ))])
async def get_sensor(id: uuid.UUID, session: AuthedAsyncDBSession):
    row = await session.get(Sensor, id)
    if row is None:
        raise HTTPException(404, 'Sensor model not found')
    return await _sensor_admin(session, row)


@catalog_router.post('/sensors', response_model=SensorAdminRead, status_code=201,
            dependencies=[Depends(_admin_write)])
async def create_sensor(body: SensorCreate, session: AuthedAsyncDBSession):
    row = Sensor(**body.model_dump(exclude={'variables'}))
    session.add(row)
    try:
        await _replace_sensor_variables(session, row.id, body.variables)
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, 'Sensor code already exists') from None
    await session.refresh(row)
    return await _sensor_admin(session, row)


@catalog_router.patch('/sensors/{id}', response_model=SensorAdminRead,
            dependencies=[Depends(_admin_write)])
async def patch_sensor(id: uuid.UUID, body: SensorPatch, session: AuthedAsyncDBSession):
    row = await session.get(Sensor, id)
    if row is None:
        raise HTTPException(404, 'Sensor model not found')
    changes = body.model_dump(exclude_unset=True)
    if 'code' in changes:
        raise HTTPException(409, 'Sensor code is immutable')
    if any(value is None for key, value in changes.items() if key not in {'description', 'variables'}):
        raise HTTPException(422, 'Required fields cannot be null')
    variables = changes.pop('variables', None)
    for key, value in changes.items():
        setattr(row, key, value)
    if 'variables' in body.model_fields_set:
        if variables is None:
            raise HTTPException(422, 'variables cannot be null')
        await _replace_sensor_variables(session, id, body.variables)
    await session.commit()
    await session.refresh(row)
    return await _sensor_admin(session, row)


@catalog_router.delete('/sensors/{id}', response_model=SensorAdminRead,
            dependencies=[Depends(_admin_write)])
async def deactivate_sensor(id: uuid.UUID, session: AuthedAsyncDBSession):
    return await patch_sensor(id, SensorPatch(is_active=False), session)


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
