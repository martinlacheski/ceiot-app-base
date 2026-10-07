"""Firmware catalog and OTA attempts.

Every device runs the same ESP-IDF firmware (``esp32/``, ``project(iot_device)``), so a release is
just one uploaded image identified by the version its own descriptor carries. ``FirmwareUpdate``
is one attempt to install a release on one device, identified by the ``request_id`` that travels
in ``ota/command`` and comes back in every ``ota/status``. Allowed states are a string enum
enforced by a CHECK constraint.
"""

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlmodel import Field, SQLModel, func

from app.core.time import utc_now


class FirmwareUpdateState(str, Enum):
    REQUESTED = "requested"  # created by the platform, command published, no answer yet
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    DOWNLOADING = "downloading"
    VERIFYING = "verifying"
    INSTALLING = "installing"
    REBOOTING = "rebooting"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


TERMINAL_STATES = frozenset(
    {
        FirmwareUpdateState.REJECTED,
        FirmwareUpdateState.SUCCEEDED,
        FirmwareUpdateState.FAILED,
        FirmwareUpdateState.ROLLED_BACK,
    }
)

STATE_CHECK = "state IN ({})".format(", ".join(f"'{state.value}'" for state in FirmwareUpdateState))


class FirmwareRelease(SQLModel, table=True):
    __tablename__ = "firmware_release"
    __table_args__ = (
        UniqueConstraint("version", name="uq_firmware_release_version"),
        # 0x400000: the size of the ota_0/ota_1 partitions in esp32/partitions.csv.
        CheckConstraint("size > 0 AND size <= 4194304", name="ck_firmware_release_size"),
    )

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    version: str
    storage_key: str
    sha256: str
    size: int
    notes: Optional[str] = Field(default=None)
    created_by: Optional[uuid.UUID] = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=utc_now)
    active: bool = Field(default=True)


class FirmwareUpdate(SQLModel, table=True):
    __tablename__ = "firmware_update"
    __table_args__ = (
        UniqueConstraint("request_id", name="uq_firmware_update_request_id"),
        CheckConstraint(STATE_CHECK, name="ck_firmware_update_state"),
        CheckConstraint(
            "progress IS NULL OR (progress >= 0 AND progress <= 100)",
            name="ck_firmware_update_progress",
        ),
    )

    id: Optional[uuid.UUID] = Field(default_factory=uuid.uuid4, primary_key=True)
    request_id: str
    device_id: uuid.UUID = Field(foreign_key="device.id", index=True)
    device_serial: str = Field(index=True)
    release_id: uuid.UUID = Field(foreign_key="firmware_release.id")
    state: str = Field(default=FirmwareUpdateState.REQUESTED.value)
    progress: Optional[int] = Field(default=None)
    error_code: Optional[str] = Field(default=None)
    error_message: Optional[str] = Field(default=None)
    running_version: Optional[str] = Field(default=None)
    target_version: str
    created_by: Optional[uuid.UUID] = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: Optional[datetime] = Field(default=None, sa_column_kwargs={"onupdate": func.now()})
    # The token is the only credential of `GET /firmware/download/{token}` (the device has no
    # user token): unguessable, unique, valid until `download_expires_at`.
    download_token: Optional[str] = Field(default=None, unique=True, index=True)
    download_expires_at: Optional[datetime] = Field(default=None)
    downloaded_at: Optional[datetime] = Field(default=None)
    # The device history record of the outcome (`deviceoperation.id`). `deviceoperation` is a
    # hypertable keyed by (time, id), so this is a plain reference, not a foreign key; it makes
    # the record idempotent (written once, then only its status changes).
    operation_id: Optional[uuid.UUID] = Field(default=None)
