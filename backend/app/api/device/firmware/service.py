"""Use cases of the firmware catalog and the OTA attempts (platform side of the OTA contract).

Topics (all under the device's own tree, so `mqtt/acl.conf` needs no change):
- `iot/devices/{serial}/ota/command`   backend -> device: install this image.
- `iot/devices/{serial}/ota/status`    device -> backend: progress and outcome of an attempt.
- `iot/devices/{serial}/ota/check`     device -> backend: is there a newer release?
- `iot/devices/{serial}/ota/request`   device -> backend: install this release.
- `iot/devices/{serial}/ota/available` backend -> device: answer to `check` and refused `request`.
"""

import hashlib
import io
import logging
import secrets
import uuid
from datetime import timedelta
from enum import Enum

from sqlalchemy import func, or_, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.api.device.firmware.models import (
    TERMINAL_STATES,
    FirmwareRelease,
    FirmwareUpdate,
    FirmwareUpdateState,
)
from app.api.device.firmware.rules import (
    FIRMWARE_PROJECT,
    FirmwareValidationError,
    parse_app_descriptor,
    validate_image,
    validate_version,
)
from app.api.device.firmware.status import OtaCheckPayload, OtaRequestPayload, OtaStatusPayload
from app.api.device.models import Device
from app.api.device.operations.models import DeviceOperation, DeviceOperationStatus, DeviceOperationType
from app.api.device.service import DeviceService
from app.core.config import settings
from app.core.emqx_presence import PresenceSnapshot
from app.core.mqtt.client import get_mqtt_client
from app.core.search import ILIKE_ESCAPE, ilike_pattern
from app.core.sorting import parse_sort
from app.core.storage import ObjectStorage, StorageUnavailable
from app.core.time import utc_now

logger = logging.getLogger(__name__)

# The device downloads right after it accepts the command; 10 minutes leave room for a slow start
# and retries. The URL is a short backend URL carrying the token (never a presigned S3 URL).
DOWNLOAD_TOKEN_TTL = timedelta(minutes=10)
DOWNLOAD_PATH = "/api/firmware/download"
# Longest URL the device's HTTP client accepts.
MAX_URL_LENGTH = 1024
# An attempt that never reached a final status (message lost, device never came back) stops
# blocking a new update after this long.
STALE_ATTEMPT_AFTER = timedelta(minutes=30)

# The device left the broker before `rebooting` (power cut, Wi-Fi lost): the new image was not
# switched in, so nothing changed. A final status it sends later still replaces this one.
INTERRUPTED_CODE = "interrupted"
INTERRUPTED_MESSAGE = "El dispositivo se desconectó durante la actualización. No se cambió nada."
_INTERRUPTIBLE_STATES = frozenset(
    {
        FirmwareUpdateState.REQUESTED,
        FirmwareUpdateState.ACCEPTED,
        FirmwareUpdateState.DOWNLOADING,
        FirmwareUpdateState.VERIFYING,
        FirmwareUpdateState.INSTALLING,
    }
)

OFFLINE_DETAIL = "El dispositivo está sin conexión"
IN_PROGRESS_DETAIL = "Ya hay una actualización en curso para este dispositivo"
STORAGE_UNAVAILABLE_DETAIL = "Almacenamiento no disponible"
DUPLICATE_DETAIL = "Ya existe un firmware con esa versión"
SORT_FIELDS = {"createdAt": "created_at", "version": "version"}

_ORDER = {
    FirmwareUpdateState.REQUESTED: 0,
    FirmwareUpdateState.ACCEPTED: 1,
    FirmwareUpdateState.DOWNLOADING: 2,
    FirmwareUpdateState.VERIFYING: 3,
    FirmwareUpdateState.INSTALLING: 4,
    FirmwareUpdateState.REBOOTING: 5,
}


def may_transition(current: FirmwareUpdateState, new: FirmwareUpdateState) -> bool:
    """Whether an `ota/status` moving an attempt from `current` to `new` may be applied: a final
    state is never left, a final status wins over any non-final one, and a non-final status never
    moves the attempt backwards."""
    if current in TERMINAL_STATES:
        return False
    if new in TERMINAL_STATES:
        return True
    return _ORDER[new] >= _ORDER[current]


def _supersedes_interruption(attempt: FirmwareUpdate, new: FirmwareUpdateState) -> bool:
    """A final outcome from the device replaces the `interrupted` failure the platform assumed when
    the device went offline (the image may already have been switched in)."""
    return (
        attempt.state == FirmwareUpdateState.FAILED.value
        and attempt.error_code == INTERRUPTED_CODE
        and new in (FirmwareUpdateState.SUCCEEDED, FirmwareUpdateState.ROLLED_BACK)
    )


class FirmwareError(Exception):
    """A refused firmware operation. `code` is the closed reason a device is told in
    `ota/available` (`release_unavailable`, `in_progress`, `same_version`, `internal`); the admin
    API only uses `status_code` and the Spanish `detail`."""

    def __init__(self, status_code: int, detail: str, code: str = "internal"):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code


class StatusOutcome(str, Enum):
    UPDATED = "updated"
    IGNORED = "ignored"


def download_url(token: str) -> str:
    """The URL a device downloads an image from: `{base}/api/firmware/download/{token}`."""
    base = settings.FIRMWARE_DOWNLOAD_BASE_URL or settings.BACKEND_PUBLIC_BASE_URL or settings.BACKEND_HOST_URL
    return f"{base.rstrip('/')}{DOWNLOAD_PATH}/{token}"


def is_online(device: Device, presence: PresenceSnapshot | None) -> bool:
    """Live EMQX presence when the snapshot is available; otherwise the last state the broker
    reported through `iot/devices/{serial}/status`."""
    if presence is not None and presence.client_ids is not None:
        return DeviceService.normalize_serial(device.serial) in presence.client_ids
    return bool(device.broker_connected)


def _publish(topic: str, body: dict) -> None:
    get_mqtt_client().publish(topic, body, qos=1)


class FirmwareService:
    def __init__(self, session: AsyncSession, store: ObjectStorage | None = None):
        self.session = session
        self.store = store

    # --- catalog -------------------------------------------------------------------------------

    async def upload_release(
        self,
        *,
        version: str | None,
        notes: str | None,
        data: bytes,
        user: User,
        deactivate_previous: bool = True,
    ) -> tuple[FirmwareRelease, int]:
        """Store a release; returns it with the number of other releases it deactivated."""
        if self.store is None:
            raise FirmwareError(503, "Almacenamiento no configurado")
        try:
            validate_image(data)
            descriptor = parse_app_descriptor(data)
            embedded = validate_version(descriptor.version)
        except FirmwareValidationError as exc:
            raise FirmwareError(422, str(exc)) from exc
        if descriptor.project_name != FIRMWARE_PROJECT:
            raise FirmwareError(
                422,
                f"El archivo es del proyecto '{descriptor.project_name}', no del firmware de los "
                f"dispositivos ({FIRMWARE_PROJECT})",
            )
        # The version lives in the image: a typed one may only confirm it.
        if version is not None and version.strip() and version.strip() != embedded:
            raise FirmwareError(422, f"La versión no coincide con la del archivo ({embedded})")

        existing = await self.session.exec(select(FirmwareRelease.id).where(FirmwareRelease.version == embedded))
        if existing.first() is not None:
            raise FirmwareError(409, DUPLICATE_DETAIL)

        sha256 = hashlib.sha256(data).hexdigest()
        release = FirmwareRelease(
            version=embedded,
            storage_key="",
            sha256=sha256,
            size=len(data),
            notes=(notes or "").strip() or None,
            created_by=user.id,
        )
        # One object per row: a lost duplicate race only ever deletes its own object.
        release.storage_key = f"firmware/{release.id}.bin"
        try:
            await self.store.put(
                release.storage_key,
                io.BytesIO(data),
                content_type="application/octet-stream",
                sha256=sha256,
                size=len(data),
            )
        except StorageUnavailable as exc:
            raise FirmwareError(503, STORAGE_UNAVAILABLE_DETAIL) from exc

        deactivated = 0
        try:
            # SAVEPOINT: a full rollback would also revert the uncommitted RLS identity of this session.
            async with self.session.begin_nested():
                self.session.add(release)
                await self.session.flush()
                if deactivate_previous:
                    result = await self.session.exec(
                        update(FirmwareRelease)
                        .where(col(FirmwareRelease.active).is_(True), FirmwareRelease.id != release.id)
                        .values(active=False)
                    )
                    deactivated = result.rowcount or 0
            await self.session.commit()
        except IntegrityError as exc:
            await self._discard(release.storage_key)
            raise FirmwareError(409, DUPLICATE_DETAIL) from exc
        except Exception:
            await self._discard(release.storage_key)
            raise
        await self.session.refresh(release)
        return release, deactivated

    async def _discard(self, key: str) -> None:
        try:
            await self.store.delete(key)
        except StorageUnavailable:
            logger.warning("firmware upload: could not delete the orphan object key=%s", key)

    async def list_releases(self, *, active: bool | None = None) -> list[FirmwareRelease]:
        statement = select(FirmwareRelease)
        if active is not None:
            statement = statement.where(FirmwareRelease.active == active)
        result = await self.session.exec(
            statement.order_by(col(FirmwareRelease.created_at).desc(), col(FirmwareRelease.id))
        )
        return list(result.all())

    async def page_releases(
        self,
        *,
        page: int = 1,
        per_page: int = 10,
        search: str | None = None,
        active: bool | None = None,
        sort: str | None = None,
    ) -> dict:
        """One page of the catalog. `sort` is `field:direction[,field:direction]` over `createdAt`
        and `version` (newest first when absent), like the other admin lists."""
        statement = select(FirmwareRelease)
        if active is not None:
            statement = statement.where(FirmwareRelease.active == active)
        pattern = ilike_pattern(search)
        if pattern is not None:
            statement = statement.where(
                or_(
                    col(FirmwareRelease.version).ilike(pattern, escape=ILIKE_ESCAPE),
                    col(FirmwareRelease.notes).ilike(pattern, escape=ILIKE_ESCAPE),
                )
            )
        total = (await self.session.exec(select(func.count()).select_from(statement.subquery()))).one()

        spec = parse_sort(sort, SORT_FIELDS, max_fields=2) or (("created_at", "desc"),)
        ordering = [
            getattr(FirmwareRelease, field).desc() if direction == "desc" else getattr(FirmwareRelease, field).asc()
            for field, direction in spec
        ]
        result = await self.session.exec(
            statement.order_by(*ordering, col(FirmwareRelease.id)).offset((page - 1) * per_page).limit(per_page)
        )
        return {
            "items": list(result.all()),
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
        }

    async def set_active(self, release_id: uuid.UUID, active: bool) -> FirmwareRelease:
        release = await self.session.get(FirmwareRelease, release_id)
        if release is None:
            raise FirmwareError(404, "Firmware no encontrado")
        release.active = active
        self.session.add(release)
        await self.session.commit()
        await self.session.refresh(release)
        return release

    # --- updates -------------------------------------------------------------------------------

    async def start_update(
        self,
        *,
        device_id: uuid.UUID,
        release_id: uuid.UUID,
        force: bool,
        user: User,
        presence: PresenceSnapshot | None = None,
    ) -> FirmwareUpdate:
        device = await self.session.get(Device, device_id)
        if device is None:
            raise FirmwareError(404, "Dispositivo no encontrado")
        release = await self.session.get(FirmwareRelease, release_id)
        if release is None:
            raise FirmwareError(404, "Firmware no encontrado")
        self._ensure_installable(release)
        if not is_online(device, presence):
            raise FirmwareError(409, OFFLINE_DETAIL)
        if await self._has_update_in_progress(device.id):
            raise FirmwareError(409, IN_PROGRESS_DETAIL, "in_progress")
        return await self._issue_command(
            device, release, force=force, request_id=str(uuid.uuid4()), created_by=user.id
        )

    def _ensure_installable(self, release: FirmwareRelease) -> None:
        """The checks every update shares, whoever starts it (admin or the device itself)."""
        if not release.active:
            raise FirmwareError(409, "El firmware está desactivado", "release_unavailable")
        if self.store is None:
            raise FirmwareError(503, "Almacenamiento no configurado")

    async def _issue_command(
        self,
        device: Device,
        release: FirmwareRelease,
        *,
        force: bool,
        request_id: str,
        created_by: uuid.UUID | None,
        running_version: str | None = None,
    ) -> FirmwareUpdate:
        """Stores the attempt and publishes its `ota/command` (same path for both entries)."""
        token = secrets.token_urlsafe(32)
        url = download_url(token)
        if len(url) > MAX_URL_LENGTH:
            raise FirmwareError(500, "La URL de descarga supera el largo admitido por el dispositivo")

        attempt = FirmwareUpdate(
            request_id=request_id,
            device_id=device.id,
            device_serial=device.serial,
            release_id=release.id,
            target_version=release.version,
            running_version=running_version or device.firmware_version,
            created_by=created_by,
            download_token=token,
            download_expires_at=utc_now() + DOWNLOAD_TOKEN_TTL,
        )
        self.session.add(attempt)
        await self.session.commit()
        await self.session.refresh(attempt)

        # The URL may be plain http on a LAN: sha256 and size let the device verify the image
        # before installing it (the command itself arrives over mutual-TLS MQTT).
        command = {
            "request_id": attempt.request_id,
            "version": release.version,
            "url": url,
            "sha256": release.sha256,
            "size": release.size,
        }
        if force:
            command["force"] = True
        _publish(f"iot/devices/{device.serial}/ota/command", command)
        return attempt

    async def open_download(self, token: str) -> FirmwareRelease | None:
        """The release an attempt's download token authorizes, or None when the token is unknown
        or expired, or the image is gone (the caller answers a plain 404 for every case). The
        token may be used again until it expires; the first download is recorded."""
        result = await self.session.exec(select(FirmwareUpdate).where(FirmwareUpdate.download_token == token))
        attempt = result.first()
        if attempt is None or attempt.download_expires_at is None or attempt.download_expires_at <= utc_now():
            return None
        release = await self.session.get(FirmwareRelease, attempt.release_id)
        if release is None or self.store is None:
            return None
        try:
            present = await self.store.exists(release.storage_key)
        except StorageUnavailable as exc:
            raise FirmwareError(503, STORAGE_UNAVAILABLE_DETAIL) from exc
        if not present:
            logger.warning("firmware download: image missing release=%s", release.id)
            return None
        if attempt.downloaded_at is None:
            attempt.downloaded_at = utc_now()
            self.session.add(attempt)
            await self.session.commit()
        return release

    async def list_updates(self, device_id: uuid.UUID, limit: int = 20) -> list[FirmwareUpdate]:
        result = await self.session.exec(
            select(FirmwareUpdate)
            .where(FirmwareUpdate.device_id == device_id)
            .order_by(col(FirmwareUpdate.created_at).desc(), col(FirmwareUpdate.id))
            .limit(limit)
        )
        return list(result.all())

    async def _has_update_in_progress(self, device_id: uuid.UUID) -> bool:
        terminal = [state.value for state in TERMINAL_STATES]
        result = await self.session.exec(
            select(FirmwareUpdate.id).where(
                FirmwareUpdate.device_id == device_id,
                col(FirmwareUpdate.state).not_in(terminal),
                FirmwareUpdate.created_at >= utc_now() - STALE_ATTEMPT_AFTER,
            )
        )
        return result.first() is not None

    # --- updates the device asks for (ota/check, ota/request) ----------------------------------

    async def handle_check(self, serial: str, data: dict) -> None:
        """`ota/check`: answers with the latest ACTIVE release, or a null version when the device
        already runs it (or there is none). Creates nothing."""
        try:
            payload = OtaCheckPayload.model_validate(data)
        except ValueError:
            logger.warning("ota/check ignored: invalid payload serial=%s", serial)
            return
        device = await self._device_by_serial(serial)
        if device is None:
            logger.info("ota/check ignored: unknown serial=%s", serial)
            return
        running = payload.running_version or device.firmware_version
        latest = await self._latest_active_release()
        if latest is None or latest.version == running:
            self._answer(device.serial, payload.request_id)
            return
        self._answer(device.serial, payload.request_id, release=latest)

    async def handle_request(self, serial: str, data: dict) -> None:
        """`ota/request`: the device asks for one release. Same checks as the admin's update (the
        device is online by definition); the attempt keeps the device's request id and the usual
        `ota/command` follows. A refusal is answered with `ota/available`."""
        try:
            payload = OtaRequestPayload.model_validate(data)
        except ValueError:
            logger.warning("ota/request ignored: invalid payload serial=%s", serial)
            return
        device = await self._device_by_serial(serial)
        if device is None:
            logger.info("ota/request ignored: unknown serial=%s", serial)
            return
        existing = await self.session.exec(
            select(FirmwareUpdate.id).where(FirmwareUpdate.request_id == payload.request_id)
        )
        if existing.first() is not None:
            return  # QoS 1 redelivery: the command already went out
        try:
            running = payload.running_version or device.firmware_version
            result = await self.session.exec(select(FirmwareRelease).where(FirmwareRelease.version == payload.version))
            release = result.first()
            if release is None:
                raise FirmwareError(409, "El firmware ya no está disponible", "release_unavailable")
            self._ensure_installable(release)
            if release.version == running:
                raise FirmwareError(409, "El dispositivo ya tiene esta versión", "same_version")
            if await self._has_update_in_progress(device.id):
                raise FirmwareError(409, IN_PROGRESS_DETAIL, "in_progress")
            await self._issue_command(
                device, release, force=False, request_id=payload.request_id, created_by=None, running_version=running
            )
        except FirmwareError as exc:
            self._answer(device.serial, payload.request_id, error=(exc.code, exc.detail))

    @staticmethod
    def _answer(
        serial: str,
        request_id: str,
        *,
        release: FirmwareRelease | None = None,
        error: tuple[str, str] | None = None,
    ) -> None:
        body: dict = {"request_id": request_id, "version": release.version if release else None}
        if release is not None:
            body["size"] = release.size
        if error is not None:
            body["error"] = {"code": error[0], "message": error[1]}
        _publish(f"iot/devices/{serial}/ota/available", body)

    async def _latest_active_release(self) -> FirmwareRelease | None:
        result = await self.session.exec(
            select(FirmwareRelease)
            .where(col(FirmwareRelease.active).is_(True))
            .order_by(col(FirmwareRelease.created_at).desc(), col(FirmwareRelease.id))
            .limit(1)
        )
        return result.first()

    async def _device_by_serial(self, serial: str) -> Device | None:
        result = await self.session.exec(select(Device).where(Device.serial == DeviceService.normalize_serial(serial)))
        return result.first()

    # --- ota/status ----------------------------------------------------------------------------

    async def apply_status(self, serial: str, data: dict) -> StatusOutcome:
        """Applies one `ota/status` of the device. Ignores what is not this device's attempt, a
        status that would move the attempt backwards and anything after a final status, so a QoS 1
        redelivery or a late message changes nothing."""
        try:
            payload = OtaStatusPayload.model_validate(data)
        except ValueError:
            logger.warning("ota/status ignored: invalid payload serial=%s", serial)
            return StatusOutcome.IGNORED
        serial = DeviceService.normalize_serial(serial)

        # The device publishes statuses a few ms apart (`accepted`, then `failed`) and the broker
        # delivers them to concurrent handlers: lock the attempt (`FOR UPDATE`) so the second
        # handler waits for the first commit, and `populate_existing` so it re-reads the row the
        # first one wrote instead of deciding on a stale copy and overwriting it.
        result = await self.session.exec(
            select(FirmwareUpdate)
            .where(FirmwareUpdate.request_id == payload.request_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        attempt = result.first()
        if attempt is None or attempt.device_serial != serial:
            logger.info("ota/status ignored: unknown request_id serial=%s", serial)
            await self._release_lock()
            return StatusOutcome.IGNORED

        current = FirmwareUpdateState(attempt.state)
        new = FirmwareUpdateState(payload.state)
        supersedes = _supersedes_interruption(attempt, new)
        if not may_transition(current, new) and not supersedes:
            await self._release_lock()
            return StatusOutcome.IGNORED

        attempt.state = new.value
        if supersedes:
            attempt.error_code = None
            attempt.error_message = None
        if new is FirmwareUpdateState.DOWNLOADING and payload.progress is not None:
            attempt.progress = payload.progress
        if new is FirmwareUpdateState.SUCCEEDED:
            attempt.progress = 100
        if payload.running_version:
            attempt.running_version = payload.running_version
        if payload.error is not None:
            attempt.error_code = payload.error.code
            attempt.error_message = payload.error.message
        if new in TERMINAL_STATES:
            # Same transaction as the state, under the row lock: written once per outcome.
            await self._record_history(attempt)
        self.session.add(attempt)
        await self.session.commit()
        return StatusOutcome.UPDATED

    async def interrupt_updates(self, serial: str) -> int:
        """The device left the broker (`status` offline): its attempt that had not reached
        `rebooting` ends `failed`/`interrupted` instead of blocking new updates until it goes
        stale. Returns how many attempts were interrupted."""
        result = await self.session.exec(
            select(FirmwareUpdate)
            .where(
                FirmwareUpdate.device_serial == DeviceService.normalize_serial(serial),
                col(FirmwareUpdate.state).in_([state.value for state in _INTERRUPTIBLE_STATES]),
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        attempts = list(result.all())
        for attempt in attempts:
            attempt.state = FirmwareUpdateState.FAILED.value
            attempt.error_code = INTERRUPTED_CODE
            attempt.error_message = INTERRUPTED_MESSAGE
            await self._record_history(attempt)
            self.session.add(attempt)
        await self.session.commit()
        for attempt in attempts:
            logger.info("OTA attempt interrupted (device offline) serial=%s request_id=%s", serial, attempt.request_id)
        return len(attempts)

    async def _release_lock(self) -> None:
        # Commit (nothing changed) rather than roll back: a rollback would also revert an RLS
        # identity set earlier in this transaction (see `system_session`).
        await self.session.commit()

    async def _record_history(self, attempt: FirmwareUpdate) -> None:
        """One device history record per attempt: created at its first outcome; a final status
        that replaces an interruption only changes that record's status."""
        status = (
            DeviceOperationStatus.SUCCESS
            if attempt.state == FirmwareUpdateState.SUCCEEDED.value
            else DeviceOperationStatus.FAILED
        )
        if attempt.operation_id is not None:
            await self.session.exec(
                update(DeviceOperation).where(col(DeviceOperation.id) == attempt.operation_id).values(status=status)
            )
            return
        operation = DeviceOperation(
            operation_type=DeviceOperationType.FIRMWARE_UPDATE,
            device_id=attempt.device_id,
            device_serial=attempt.device_serial,
            status=status,
        )
        self.session.add(operation)
        attempt.operation_id = operation.id
