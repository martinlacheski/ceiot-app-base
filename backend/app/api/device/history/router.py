"""Read-only device history by snapshot serial and environment."""

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth.models import User
from app.api.device.history.query_utils import MAX_PAGE_SIZE, SortOrder
from app.api.device.history.schemas import (
    HistoryDevicesResponse, HistoryOperationsResponse, HistorySensorReadingsResponse,
)
from app.api.device.history.service import DeviceHistoryService, ReadingFilters
from app.api.device.operations.models import DeviceOperationStatus, DeviceOperationType
from app.api.sensor_catalog.permissions import SensorCatalogPermissions
from app.api.sensor_catalog.telemetry import TelemetryPage, sensor_descriptions
from app.core.db import system_session
from app.core.dependencies import AuthedAsyncDBSession, PermissionChecker, get_current_user

router = APIRouter()

DeviceSort = Literal["serial", "device_name", "environment_name", "owner_name",
                     "first_seen", "last_seen", "readings_count", "operations_count"]
ReadingSort = Literal["time", "temperature_c", "relative_humidity_pct", "pressure_hpa",
                      "firmware_version", "wifi_rssi", "uptime", "heap_free"]
OperationSort = Literal["time", "id", "operation_type", "status"]
TelemetrySort = Literal["time", "variable"]


@router.get('/devices/{serial}/telemetry', response_model=TelemetryPage,
            dependencies=[Depends(PermissionChecker(SensorCatalogPermissions.TELEMETRY_READ))])
async def list_history_telemetry(
    serial: str,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
    environment_id: uuid.UUID | None = None,
    search: str | None = Query(None, max_length=64),
    date_from: date | None = None,
    date_to: date | None = None,
    variable: str | None = Query(None, pattern=r'^[a-z][a-z0-9_]*$'),
    variable_min: float | None = Query(None, alias='min'),
    variable_max: float | None = Query(None, alias='max'),
    sort_by: TelemetrySort = 'time',
    sort_order: SortOrder = 'desc',
    utc_offset_minutes: int = Query(0, ge=-840, le=840),
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
):
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(422, 'date_from must not be after date_to')
    if variable_min is not None and variable_max is not None and variable_min > variable_max:
        raise HTTPException(422, 'min must not be greater than max')
    if variable is None and (variable_min is not None or variable_max is not None or sort_by == 'variable'):
        raise HTTPException(422, 'variable is required for value filters or sorting')
    service = DeviceHistoryService(session)
    scope = await service.resolve_scope(current_user)
    if not scope.unrestricted and not scope.member_environment_ids:
        raise HTTPException(404, 'No history for this device')
    # The telemetry query itself is snapshot/RLS scoped. Do not resolve current ownership.
    result = await service.list_telemetry(scope, serial=serial, environment_id=environment_id,
        search=search, date_from=date_from, date_to=date_to, variable=variable,
        variable_min=variable_min, variable_max=variable_max, sort_by=sort_by,
        sort_order=sort_order, utc_offset_minutes=utc_offset_minutes,
        page=page, per_page=per_page)
    if not await service.has_history(scope, serial, environment_id):
        raise HTTPException(404, 'No history for this device')
    # Metadata is looked up only for keys already present in visible telemetry.
    # Former owners may not SELECT the current device_sensor row under RLS.
    descriptions = []
    if result['items']:
        async with system_session() as metadata_session:
            descriptions = await sensor_descriptions(metadata_session, result['items'],
                {item.device_id for item in result['items'] if item.device_id is not None})
    return TelemetryPage(**result, sensors=descriptions)


@router.get("/devices", response_model=HistoryDevicesResponse, response_model_exclude_none=True)
async def list_history_devices(
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
    environment_id: uuid.UUID | None = None,
    only_former: bool = True,
    search: str | None = Query(None, max_length=64),
    last_seen_from: date | None = None,
    last_seen_to: date | None = None,
    owner_id: uuid.UUID | None = None,
    sort_by: DeviceSort = "last_seen",
    sort_order: SortOrder = "desc",
    utc_offset_minutes: int = Query(0, ge=-840, le=840),
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=MAX_PAGE_SIZE),
):
    if owner_id is not None and not current_user.is_admin:
        raise HTTPException(403, "Owner filtering is restricted to administrators")
    return await DeviceHistoryService(session).list_devices(
        current_user, environment_id=environment_id, only_former=only_former,
        search=search, last_seen_from=last_seen_from, last_seen_to=last_seen_to,
        owner_id=owner_id, sort_by=sort_by, sort_order=sort_order,
        utc_offset_minutes=utc_offset_minutes, page=page, per_page=per_page)


@router.get("/devices/{serial}/sensor-readings", response_model=HistorySensorReadingsResponse)
async def list_history_sensor_readings(
    serial: str,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
    environment_id: uuid.UUID | None = None,
    search: str | None = Query(None, max_length=64),
    date_from: date | None = None,
    date_to: date | None = None,
    temp_min: float | None = None,
    temp_max: float | None = None,
    humidity_min: float | None = None,
    humidity_max: float | None = None,
    pressure_min: float | None = None,
    pressure_max: float | None = None,
    has_error: bool | None = None,
    firmware_version: str | None = Query(None, max_length=64),
    sort_by: ReadingSort = "time",
    sort_order: SortOrder = "desc",
    utc_offset_minutes: int = Query(0, ge=-840, le=840),
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=MAX_PAGE_SIZE),
):
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(422, "date_from must not be after date_to")
    service = DeviceHistoryService(session)
    scope = await service.resolve_scope(current_user)
    if not await service.has_history(scope, serial, environment_id):
        raise HTTPException(404, "No history for this device")
    return await service.list_sensor_readings(scope, serial=serial, environment_id=environment_id,
        search=search, filters=ReadingFilters(temp_min=temp_min, temp_max=temp_max,
        humidity_min=humidity_min, humidity_max=humidity_max, pressure_min=pressure_min,
        pressure_max=pressure_max, has_error=has_error, firmware_version=firmware_version),
        date_from=date_from, date_to=date_to,
        sort_by=sort_by, sort_order=sort_order, utc_offset_minutes=utc_offset_minutes,
        page=page, per_page=per_page)


@router.get("/devices/{serial}/operations", response_model=HistoryOperationsResponse)
async def list_history_operations(
    serial: str,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
    environment_id: uuid.UUID | None = None,
    status: DeviceOperationStatus | None = None,
    operation_type: DeviceOperationType | None = None,
    search: str | None = Query(None, max_length=64),
    date_from: date | None = None,
    date_to: date | None = None,
    sort_by: OperationSort = "time",
    sort_order: SortOrder = "desc",
    utc_offset_minutes: int = Query(0, ge=-840, le=840),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
):
    if date_from is not None and date_to is not None and date_from > date_to:
        raise HTTPException(422, "date_from must not be after date_to")
    service = DeviceHistoryService(session)
    scope = await service.resolve_scope(current_user)
    if not await service.has_history(scope, serial, environment_id):
        raise HTTPException(404, "No history for this device")
    return await service.list_operations(scope, serial=serial, environment_id=environment_id,
        status=status, operation_type=operation_type, search=search,
        date_from=date_from, date_to=date_to, sort_by=sort_by,
        sort_order=sort_order, utc_offset_minutes=utc_offset_minutes, page=page,
        per_page=per_page)
