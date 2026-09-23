from typing import Optional
from datetime import datetime
import uuid
from fastapi import APIRouter, Depends, Query
from app.core.dependencies import get_current_user, AuthedAsyncDBSession
from app.api.auth.models import User
from app.api.access.repository import GuestAccessRepository
from app.api.access.service import GuestAccessService
from app.api.device.operations.service import DeviceOperationService
from app.api.device.operations.models import DeviceOperationType

router = APIRouter()

@router.get("/by-device/{device_id}")
async def get_device_operations(
    session: AuthedAsyncDBSession,
    device_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=10000),
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    operation_type: Optional[DeviceOperationType] = None,
):
    """
    Get paginated operations for a specific device.
    Verifies that the user has access to the device.
    """
    if not current_user.is_admin and "device:read_all" not in current_user.permissions:
        access_service = GuestAccessService(GuestAccessRepository(session))
        access_starts_at = await access_service.resolve_device_guest_access_start(
            device_id,
            current_user,
        )
    else:
        access_starts_at = None

    # 2. Fetch Operations
    service = DeviceOperationService(session)
    return await service.get_by_device(
        device_id=device_id,
        page=page,
        per_page=per_page,
        start_date=start_date,
        end_date=end_date,
        operation_type=operation_type,
        access_starts_at=access_starts_at,
    )
