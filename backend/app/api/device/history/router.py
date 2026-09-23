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
from app.core.dependencies import AuthedAsyncDBSession, get_current_user

router = APIRouter()

DeviceSort = Literal["serial", "device_name", "environment_name", "owner_name",
                     "first_seen", "last_seen", "readings_count", "operations_count"]
ReadingSort = Literal["time", "temperature_c", "relative_humidity_pct", "pressure_hpa",
                      "firmware_version", "wifi_rssi", "uptime", "heap_free"]
OperationSort = Literal["time", "id", "operation_type", "status"]


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
    service = DeviceHistoryService(session)
    scope = await service.resolve_scope(current_user)
    if not await service.has_history(scope, serial, environment_id):
        raise HTTPException(404, "No history for this device")
    return await service.list_sensor_readings(scope, serial=serial, environment_id=environment_id,
        search=search, filters=ReadingFilters(temp_min=temp_min, temp_max=temp_max,
        humidity_min=humidity_min, humidity_max=humidity_max, pressure_min=pressure_min,
        pressure_max=pressure_max, has_error=has_error, firmware_version=firmware_version),
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
    sort_by: OperationSort = "time",
    sort_order: SortOrder = "desc",
    utc_offset_minutes: int = Query(0, ge=-840, le=840),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
):
    service = DeviceHistoryService(session)
    scope = await service.resolve_scope(current_user)
    if not await service.has_history(scope, serial, environment_id):
        raise HTTPException(404, "No history for this device")
    return await service.list_operations(scope, serial=serial, environment_id=environment_id,
        status=status, operation_type=operation_type, search=search, sort_by=sort_by,
        sort_order=sort_order, utc_offset_minutes=utc_offset_minutes, page=page,
        per_page=per_page)
