from fastapi import APIRouter, Depends, HTTPException, status

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
from app.core.dependencies import AuthedAsyncDBSession, PermissionChecker

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
):
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
