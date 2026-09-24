import uuid
from typing import List, Literal
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query, status
from app.api.device.models import (
    Device,
    DeviceCreate,
    DeviceListResponse,
    DevicePairingRequest,
    DeviceRead,
    DeviceUpdate,
)
from app.api.device.repository import DeviceRepository
from app.api.device.device_type.repository import DeviceTypeRepository
from app.api.device.device_type.constants import DEFAULT_DEVICE_TYPE_CODE
from app.api.device.service import DeviceService
from app.api.device.permissions import DevicePermissions, DEVICES_PERMISSIONS
from app.api.access.repository import GuestAccessRepository
from app.api.access.schemas import (
    ScopedGuestInvitationCreate,
    ScopedGuestInvitationRead,
    ScopedGuestInvitationUpdate,
    ScopedGuestRelationCreate,
    ScopedGuestRelationRead,
    ScopedGuestRelationUpdate,
)
from app.api.access.models import ScopeType
from app.api.access.service import GuestAccessService
from app.api.auth.models import User
from app.api.environment.environment.repository import EnvironmentRepository
from app.core.dependencies import (
    PermissionChecker,
    get_current_user,
    AuthedAsyncDBSession,
    SystemAsyncDBSession,
)
from app.core.db import system_session
from app.core.email import EmailService
from app.core.emqx_presence import (
    EmqxPresenceClient,
    PresenceSnapshot,
    get_emqx_presence_client,
)

router = APIRouter()


def project_broker_presence(
    devices: list[DeviceRead],
    snapshot: PresenceSnapshot,
) -> list[DeviceRead]:
    connected = snapshot.client_ids
    return [
        device.model_copy(
            update={
                "broker_connected": (
                    DeviceService.normalize_serial(device.serial) in connected
                    if connected is not None
                    else None
                )
            }
        )
        for device in devices
    ]


def get_access_service(session: AuthedAsyncDBSession) -> GuestAccessService:
    return GuestAccessService(GuestAccessRepository(session), EmailService())


async def enrich_device_owner_metadata(
    devices: list[DeviceRead],
    session: AuthedAsyncDBSession,
) -> list[DeviceRead]:
    environment_ids = [device.environment_id for device in devices if device.environment_id]
    owner_metadata = await EnvironmentRepository(session).get_owner_metadata(environment_ids)
    missing_environment_ids = [
        environment_id
        for environment_id in environment_ids
        if environment_id not in owner_metadata
    ]
    if missing_environment_ids:
        async with system_session() as sys_session:
            owner_metadata.update(
                await EnvironmentRepository(sys_session).get_owner_metadata(
                    missing_environment_ids,
                )
            )

    enriched: list[DeviceRead] = []
    for device in devices:
        if not device.environment or not device.environment_id:
            enriched.append(device)
            continue
        metadata = owner_metadata.get(device.environment_id)
        if not metadata:
            enriched.append(device)
            continue
        enriched.append(
            device.model_copy(
                update={
                    "environment": device.environment.model_copy(
                        update={
                            "owner_id": metadata.get("owner_id"),
                            "owner_name": metadata.get("owner_name"),
                        }
                    )
                }
            )
        )
    return enriched


@router.get("/manufacture-dates", response_model=List[date], dependencies=[Depends(PermissionChecker(DevicePermissions.READ))])
async def get_manufacture_dates(
    session: AuthedAsyncDBSession
):
    repo = DeviceRepository(session)
    return await repo.get_distinct_manufacture_dates()


@router.get("/check-serial", response_model=dict, dependencies=[Depends(PermissionChecker(DevicePermissions.PAIR))])
async def check_device_serial(
    sys_session: SystemAsyncDBSession,
    serial: str = Query(..., min_length=1),
):
    """
    Check if a device serial exists and is available for pairing.
    """
    repo = DeviceRepository(sys_session)
    device = await repo.get_by_serial(serial)

    if not device:
        return {"status": "not_found", "message": "Dispositivo no encontrado"}

    if device.environment_id is not None:
        # Get environment details if possible context allows
        # But for now just simple status is enough
        return {
            "status": "paired",
            "message": "El dispositivo ya está asociado a otro establecimiento",
            "environment_id": str(device.environment_id)
        }

    return {"status": "available", "message": "Dispositivo disponible"}


@router.get("", response_model=DeviceListResponse)
async def get_devices(
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
    presence_client: EmqxPresenceClient = Depends(get_emqx_presence_client),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=10000),
    search: str = Query(None),
    device_type_id: uuid.UUID = Query(None),
    model: str = Query(None),
    batch: str = Query(None),
    manufacture_date: date = Query(None),
    status: str = Query(None),
    enabled: bool = Query(None),
    is_active: bool = Query(None),
    environment_id: uuid.UUID = None,
    owner_id: uuid.UUID = None,
    sort_by: Literal[
        "name",
        "serial",
        "model",
        "manufactureDate",
        "status",
        "enabled",
        "isActive",
        "lastConnection",
        "brokerConnected",
        "deviceTypeName",
        "environmentName",
        "owner",
    ] = Query("name"),
    sort_order: Literal["asc", "desc"] = Query("asc"),
    utc_offset_minutes: int = Query(0, ge=-840, le=840),
):
    repo = DeviceRepository(session)

    # Secure Listing Logic
    requesting_user_id = None
    if "device:read_all" not in current_user.permissions:
        requesting_user_id = current_user.id

    owner_search_environment_ids = None
    if (
        search
        and not current_user.is_admin
        and session.get_bind().dialect.name == "postgresql"
    ):
        async with system_session() as sys_session:
            owner_search_environment_ids = await EnvironmentRepository(
                sys_session
            ).get_owner_search_environment_ids(search)

    snapshot = await presence_client.get_snapshot()
    result = await repo.get_all(
        page=page,
        per_page=per_page,
        search=search,
        device_type_id=device_type_id,
        model=model,
        batch=batch,
        manufacture_date=manufacture_date,
        status=status,
        enabled=enabled,
        is_active=is_active,
        environment_id=environment_id,
        user_id=requesting_user_id,
        owner_id=owner_id,
        sort_by=sort_by,
        sort_order=sort_order,
        connected_serials=snapshot.client_ids,
        utc_offset_minutes=utc_offset_minutes,
        owner_search_environment_ids=owner_search_environment_ids,
    )
    projected = project_broker_presence(
        [DeviceRead.model_validate(item) for item in result["items"]], snapshot
    )
    result["items"] = await enrich_device_owner_metadata(
        projected,
        session,
    )
    return result


@router.post("/pair", response_model=DeviceRead, dependencies=[Depends(PermissionChecker(DevicePermissions.PAIR))])
async def pair_device(
    request: DevicePairingRequest,
    session: AuthedAsyncDBSession,
    sys_session: SystemAsyncDBSession,
    current_user: User = Depends(get_current_user),
):
    """
    User claims a device by serial number to add to their environment.
    """
    # 1. Validate Serial
    if not DeviceService.validate_serial(request.serial):
        raise HTTPException(
            status_code=400, detail="Formato de serial inválido")

    if not current_user.is_admin:
        role = await EnvironmentRepository(session).get_user_role(
            request.environment_id,
            current_user.id,
        )
        if not role or not role.is_owner:
            raise HTTPException(
                status_code=403,
                detail="Solo el propietario del establecimiento puede asociar dispositivos",
            )

    # 2. Find Device — system session bypasses RLS so unassigned devices are visible
    sys_repo = DeviceRepository(sys_session)
    device = await sys_repo.get_by_serial(request.serial)
    if not device:
        raise HTTPException(
            status_code=404, detail="Dispositivo no encontrado")

    # 3. Check if already paired
    if device.environment_id is not None:
        raise HTTPException(
            status_code=409, detail="Dispositivo ya está asociado a otro entorno")

    # 4. Pair
    return await sys_repo.pair(
        device,
        request.environment_id,
        request.description,
    )


@router.get("/{device_id}", response_model=DeviceRead)
async def get_device(
    device_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
    presence_client: EmqxPresenceClient = Depends(get_emqx_presence_client),
):
    repo = DeviceRepository(session)
    device = await repo.get(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if not current_user.is_admin and "device:read_all" not in current_user.permissions:
        access_service = get_access_service(session)
        await access_service.resolve_device_access(device_id, current_user)
    snapshot = await presence_client.get_snapshot()
    projected = project_broker_presence([DeviceRead.model_validate(device)], snapshot)
    return (await enrich_device_owner_metadata(projected, session))[0]


@router.post("", response_model=DeviceRead, dependencies=[Depends(PermissionChecker(DevicePermissions.CREATE))])
async def create_device(
    device_in: DeviceCreate,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
):
    """
    Factory/Admin endpoint to register a new device hardware.
    """
    repo = DeviceRepository(session)
    if device_in.sensors and not (current_user.is_admin or "device_sensor:write" in current_user.permissions):
        raise HTTPException(status_code=403, detail="No tenés permiso para agregar sensores")

    # 1. Validate Serial Format & Checksum
    if not DeviceService.validate_serial(device_in.serial):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid serial format or checksum"
        )

    # 2. Check Uniqueness
    existing = await repo.get_by_serial(device_in.serial)
    if existing:
        if not existing.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Device with serial {device_in.serial} exists but is inactive.",
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Device with serial {device_in.serial} already exists."
        )

    # 2b. Manual registration policy: an Ambiental device must be registered
    # with at least one sensor. This is a POST /api/devices-only rule (not a
    # repository invariant): provisioning, pairing and other internal
    # creation paths legitimately create sensorless devices and add sensors
    # later.
    if not device_in.sensors:
        resolved_type = await DeviceTypeRepository(session).resolve_catalog_type(
            device_type_id=device_in.device_type_id,
            require_active=True,
        )
        if resolved_type is not None and resolved_type.code == DEFAULT_DEVICE_TYPE_CODE:
            raise HTTPException(
                status_code=422,
                detail="Agregá al menos un sensor para un dispositivo Ambiental",
            )

    # 3. Create
    try:
        return await repo.create_with_data(device_in)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.put("/{device_id}", response_model=DeviceRead, dependencies=[Depends(PermissionChecker(DevicePermissions.UPDATE))])
async def update_device(
    device_id: uuid.UUID,
    device_in: DeviceUpdate,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user)
):
    repo = DeviceRepository(session)

    # If Reactivating, we must be able to find it even if inactive
    include_inactive = device_in.is_active is True

    device = await repo.get(device_id, include_inactive=include_inactive)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # Security Check: If not admin, verify ownership
    if "device:read_all" not in current_user.permissions:
        access_service = get_access_service(session)
        context = await access_service.resolve_device_access(device_id, current_user)
        if not context.is_owner:
            raise HTTPException(
                status_code=403, detail="No tienes permisos para editar este dispositivo")

    try:
        updated_device = await repo.update(device, device_in)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return updated_device


@router.delete("/{device_id}", dependencies=[Depends(PermissionChecker(DevicePermissions.DELETE))])
async def delete_device(
    device_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
):
    repo = DeviceRepository(session)
    device = await repo.get(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    if not current_user.is_admin:
        context = await get_access_service(session).resolve_device_access(device_id, current_user)
        if not context.is_owner:
            raise HTTPException(
                status_code=403,
                detail="Solo el propietario del establecimiento puede eliminar dispositivos",
            )

    await repo.delete(device)
    return {"ok": True}


@router.post("/{device_id}/unpair", response_model=DeviceRead, dependencies=[Depends(PermissionChecker(DevicePermissions.PAIR))])
async def unpair_device(
    device_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user)
):
    repo = DeviceRepository(session)
    device = await repo.get(device_id)
    if not device:
        raise HTTPException(
            status_code=404, detail="Dispositivo no encontrado")

    current_environment_id = device.environment_id

    # Security Check: Only Admin or Environment Owner can unpair
    if "device:read_all" not in current_user.permissions:
        context = await get_access_service(session).resolve_device_access(device_id, current_user)
        if not context.is_owner:
            raise HTTPException(
                status_code=403, detail="Solo el propietario del establecimiento puede desvincular dispositivos")

    async with system_session() as sys_session:
        sys_repo = DeviceRepository(sys_session)
        access_repo = GuestAccessRepository(sys_session)
        current_device = await sys_repo.get(device_id)
        if not current_device:
            raise HTTPException(
                status_code=404, detail="Dispositivo no encontrado")
        if current_device.environment_id != current_environment_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El dispositivo cambio de estado. Reintenta la operacion.",
            )
        await access_repo.cleanup_device_scope_access_on_unpair(device_id)
        return await sys_repo.unpair(current_device)


@router.post(
    "/{device_id}/guest-invitations",
    response_model=ScopedGuestInvitationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_device_guest_invitation(
    device_id: uuid.UUID,
    payload: ScopedGuestInvitationCreate,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
):
    return await get_access_service(session).create_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=device_id,
        email=payload.email,
        access_starts_at=payload.access_starts_at,
        actor_user=current_user,
    )


@router.post(
    "/{device_id}/guests",
    response_model=ScopedGuestRelationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_device_guest_relation(
    device_id: uuid.UUID,
    payload: ScopedGuestRelationCreate,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
):
    return await get_access_service(session).create_guest_relation(
        scope_type=ScopeType.DEVICE,
        scope_id=device_id,
        guest_user_id=payload.guest_user_id,
        access_starts_at=payload.access_starts_at,
        actor_user=current_user,
    )


@router.delete(
    "/{device_id}/guest-invitations/{invitation_id}",
    response_model=ScopedGuestInvitationRead,
)
async def revoke_device_guest_invitation(
    device_id: uuid.UUID,
    invitation_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
):
    return await get_access_service(session).revoke_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=device_id,
        invitation_id=invitation_id,
        actor_user=current_user,
    )


@router.patch(
    "/{device_id}/guest-invitations/{invitation_id}",
    response_model=ScopedGuestInvitationRead,
)
async def update_device_guest_invitation(
    device_id: uuid.UUID,
    invitation_id: uuid.UUID,
    payload: ScopedGuestInvitationUpdate,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
):
    return await get_access_service(session).update_guest_invitation(
        scope_type=ScopeType.DEVICE,
        scope_id=device_id,
        invitation_id=invitation_id,
        access_starts_at=payload.access_starts_at,
        access_starts_at_was_provided="access_starts_at" in payload.model_fields_set,
        actor_user=current_user,
    )


@router.patch(
    "/{device_id}/guests/{guest_user_id}",
    response_model=ScopedGuestRelationRead,
)
async def update_device_guest_relation(
    device_id: uuid.UUID,
    guest_user_id: uuid.UUID,
    payload: ScopedGuestRelationUpdate,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
):
    return await get_access_service(session).update_guest_relation(
        scope_type=ScopeType.DEVICE,
        scope_id=device_id,
        guest_user_id=guest_user_id,
        access_starts_at=payload.access_starts_at,
        access_starts_at_was_provided="access_starts_at" in payload.model_fields_set,
        actor_user=current_user,
    )


@router.delete(
    "/{device_id}/guests/{guest_user_id}",
    response_model=ScopedGuestRelationRead,
)
async def deactivate_device_guest_relation(
    device_id: uuid.UUID,
    guest_user_id: uuid.UUID,
    session: AuthedAsyncDBSession,
    current_user: User = Depends(get_current_user),
):
    return await get_access_service(session).deactivate_guest_relation(
        scope_type=ScopeType.DEVICE,
        scope_id=device_id,
        guest_user_id=guest_user_id,
        actor_user=current_user,
    )
