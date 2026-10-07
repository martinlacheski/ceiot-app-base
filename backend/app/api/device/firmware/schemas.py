"""HTTP DTOs of the firmware catalog (camelCase on the wire like every device DTO)."""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import ConfigDict

from app.core.utils import CamelModel


class FirmwareReleaseRead(CamelModel):
    id: uuid.UUID
    version: str
    sha256: str
    size: int
    notes: Optional[str] = None
    created_by: Optional[uuid.UUID] = None
    created_at: datetime
    active: bool


class FirmwareReleaseUploadRead(FirmwareReleaseRead):
    """The upload answer: the release plus how many earlier releases it deactivated."""

    deactivated_previous: int = 0


class FirmwareReleasePage(CamelModel):
    items: list[FirmwareReleaseRead]
    total: int
    pages: int
    page: int
    per_page: int


class FirmwareUpdateStartRequest(CamelModel):
    model_config = ConfigDict(**CamelModel.model_config, extra="forbid")

    device_id: uuid.UUID
    release_id: uuid.UUID
    force: bool = False


class FirmwareUpdateRead(CamelModel):
    id: uuid.UUID
    request_id: str
    device_id: uuid.UUID
    device_serial: str
    release_id: uuid.UUID
    state: str
    progress: Optional[int] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    running_version: Optional[str] = None
    target_version: str
    created_by: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
