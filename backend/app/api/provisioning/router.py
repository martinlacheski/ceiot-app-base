from fastapi import APIRouter, Depends, HTTPException, status

from app.api.auth.models import User
from app.api.device.permissions import DevicePermissions
from app.api.device.repository import DeviceRepository
from app.api.provisioning.models import (
    ProvisioningDevicePrepareRequest,
    ProvisioningDevicePrepareResponse,
)
from app.api.provisioning.service import (
    ProvisioningSerialExhaustedError,
    ProvisioningService,
)
from app.api.sensor_catalog.permissions import SensorCatalogPermissions
from app.core.dependencies import AuthedAsyncDBSession, PermissionChecker, get_current_user

router = APIRouter()


def get_provisioning_service(session: AuthedAsyncDBSession) -> ProvisioningService:
    return ProvisioningService(DeviceRepository(session))


@router.post(
    "/devices/prepare",
    response_model=ProvisioningDevicePrepareResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(PermissionChecker(DevicePermissions.CREATE))],
)
async def prepare_device(
    payload: ProvisioningDevicePrepareRequest,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
):
    # Same rule as POST /api/devices: installing sensors needs sensor write access.
    if payload.sensors and not (
        current_user.is_admin
        or SensorCatalogPermissions.DEVICE_WRITE in current_user.permissions
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenés permiso para agregar sensores",
        )

    service = get_provisioning_service(session)

    try:
        device = await service.prepare_device(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except ProvisioningSerialExhaustedError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    return ProvisioningDevicePrepareResponse.model_validate(device)
