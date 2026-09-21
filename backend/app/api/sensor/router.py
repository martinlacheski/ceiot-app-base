import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.access.repository import GuestAccessRepository
from app.api.access.service import GuestAccessService
from app.api.auth.models import User
from app.api.sensor.permissions import SensorPermissions
from app.api.sensor.repository import SensorRepository
from app.api.sensor.schemas import SensorReadingListResponse, SensorReadingRead
from app.api.sensor.service import SensorService
from app.core.dependencies import (
    AuthedAsyncDBSession,
    PermissionChecker,
    get_current_user,
)
from app.core.time import utc_now


router = APIRouter()


def _as_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


async def _resolve_access_start(
    device_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    current_user: User,
) -> datetime | None:
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
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes acceso contextual a este dispositivo",
        )

    access_starts_at = _as_utc_naive(access_starts_at)
    if access_starts_at > utc_now():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El acceso a este dispositivo todavía no está vigente",
        )
    return access_starts_at


@router.get(
    "/{device_id}/sensor-readings/latest",
    response_model=SensorReadingListResponse,
    dependencies=[Depends(PermissionChecker(SensorPermissions.READ))],
)
async def get_latest_sensor_readings(
    device_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
    limit: int = Query(10, ge=1, le=1000),
):
    access_starts_at = await _resolve_access_start(device_id, session, current_user)
    service = SensorService(SensorRepository(session))
    readings, total = await service.get_latest_readings_by_device_id(
        device_id=device_id,
        limit=limit,
        start_time=access_starts_at,
    )
    return SensorReadingListResponse(
        items=[SensorReadingRead.model_validate(reading) for reading in readings],
        total=total,
    )


@router.get(
    "/{device_id}/sensor-readings/history",
    response_model=SensorReadingListResponse,
    dependencies=[Depends(PermissionChecker(SensorPermissions.READ))],
)
async def get_sensor_reading_history(
    device_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
    start: datetime = Query(...),
    end: datetime = Query(...),
):
    access_starts_at = await _resolve_access_start(device_id, session, current_user)
    start = _as_utc_naive(start)
    end = _as_utc_naive(end)
    if start > end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="start must be less than or equal to end",
        )
    if access_starts_at is not None:
        start = max(start, access_starts_at)

    service = SensorService(SensorRepository(session))
    readings = await service.get_readings_by_device_id_and_range(
        device_id=device_id,
        start_time=start,
        end_time=end,
    )
    return SensorReadingListResponse(
        items=[SensorReadingRead.model_validate(reading) for reading in readings],
        total=len(readings),
    )
