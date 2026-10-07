"""Firmware catalog and OTA routes, mounted under /firmware. Admin only: one firmware reaches every
device, so no owner or guest permission applies. The download route is the exception: the device
has no user, its attempt's short-lived token is the authorization."""

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse

from app.api.auth.models import User
from app.api.device.firmware.rules import MAX_IMAGE_BYTES
from app.api.device.firmware.schemas import (
    FirmwareReleasePage,
    FirmwareReleaseRead,
    FirmwareReleaseUploadRead,
    FirmwareUpdateRead,
    FirmwareUpdateStartRequest,
)
from app.api.device.firmware.service import FirmwareError, FirmwareService
from app.core.dependencies import AuthedAsyncDBSession, SystemAsyncDBSession, get_current_user
from app.core.emqx_presence import EmqxPresenceClient, get_emqx_presence_client
from app.core.logging_config import install_download_token_mask
from app.core.storage import ObjectStorage, get_storage

# The download URL carries the token: keep it out of the access log of the API process.
install_download_token_mask()

router = APIRouter()


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un administrador puede gestionar el firmware",
        )
    return current_user


def _raise(error: FirmwareError):
    raise HTTPException(status_code=error.status_code, detail=error.detail) from error


@router.post("/releases", response_model=FirmwareReleaseUploadRead, status_code=status.HTTP_201_CREATED)
async def upload_release(
    session: AuthedAsyncDBSession,
    file: UploadFile = File(...),
    version: str | None = Form(None),
    notes: str | None = Form(None),
    deactivate_previous: bool = Form(True),
    current_user: User = Depends(require_admin),
    store: ObjectStorage = Depends(get_storage),
):
    """The version comes from the image descriptor; a typed `version` may only confirm it."""
    # Read one byte more than the limit: an oversize image is rejected without loading all of it.
    data = await file.read(MAX_IMAGE_BYTES + 1)
    try:
        release, deactivated = await FirmwareService(session, store).upload_release(
            version=version,
            notes=notes,
            data=data,
            user=current_user,
            deactivate_previous=deactivate_previous,
        )
    except FirmwareError as error:
        _raise(error)
    return FirmwareReleaseUploadRead.model_validate(
        {**FirmwareReleaseRead.model_validate(release).model_dump(), "deactivated_previous": deactivated}
    )


@router.get("/releases", response_model=list[FirmwareReleaseRead])
async def list_releases(
    session: AuthedAsyncDBSession,
    active: bool | None = Query(None),
    _admin: User = Depends(require_admin),
):
    return await FirmwareService(session).list_releases(active=active)


@router.get("/releases/page", response_model=FirmwareReleasePage)
async def page_releases(
    session: AuthedAsyncDBSession,
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    search: str | None = Query(None),
    active: bool | None = Query(None),
    sort: str | None = Query(None),
    _admin: User = Depends(require_admin),
):
    return await FirmwareService(session).page_releases(
        page=page, per_page=per_page, search=search, active=active, sort=sort
    )


@router.post("/releases/{release_id}/deactivate", response_model=FirmwareReleaseRead)
async def deactivate_release(release_id: uuid.UUID, session: AuthedAsyncDBSession, _admin: User = Depends(require_admin)):
    try:
        return await FirmwareService(session).set_active(release_id, False)
    except FirmwareError as error:
        _raise(error)


@router.post("/releases/{release_id}/activate", response_model=FirmwareReleaseRead)
async def activate_release(release_id: uuid.UUID, session: AuthedAsyncDBSession, _admin: User = Depends(require_admin)):
    try:
        return await FirmwareService(session).set_active(release_id, True)
    except FirmwareError as error:
        _raise(error)


@router.post("/updates", response_model=FirmwareUpdateRead, status_code=status.HTTP_201_CREATED)
async def start_update(
    payload: FirmwareUpdateStartRequest,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(require_admin),
    store: ObjectStorage = Depends(get_storage),
    presence_client: EmqxPresenceClient = Depends(get_emqx_presence_client),
):
    try:
        return await FirmwareService(session, store).start_update(
            device_id=payload.device_id,
            release_id=payload.release_id,
            force=payload.force,
            user=current_user,
            presence=await presence_client.get_snapshot(),
        )
    except FirmwareError as error:
        _raise(error)


@router.get("/devices/{device_id}/updates", response_model=list[FirmwareUpdateRead])
async def list_device_updates(
    device_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    limit: int = Query(20, ge=1, le=100),
    _admin: User = Depends(require_admin),
):
    return await FirmwareService(session).list_updates(device_id, limit)


@router.get("/download/{token}", include_in_schema=False)
async def download_image(token: str, session: SystemAsyncDBSession, store: ObjectStorage = Depends(get_storage)):
    """What a device downloads (`ota/command.url`). Unknown and expired tokens are the same plain
    404. The token is never logged."""
    try:
        release = await FirmwareService(session, store).open_download(token)
    except FirmwareError as error:
        _raise(error)
    if release is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return StreamingResponse(
        store.stream(release.storage_key),
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-store", "Content-Length": str(release.size)},
    )
