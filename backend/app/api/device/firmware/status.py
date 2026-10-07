"""Bodies of the OTA topics the device publishes (`iot/devices/{serial}/ota/...`)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr


class OtaStatusError(BaseModel):
    model_config = ConfigDict(extra="ignore")

    code: StrictStr = Field(min_length=1, max_length=64)
    message: StrictStr = Field(default="", max_length=500)


class OtaStatusPayload(BaseModel):
    """`ota/status` (device -> backend)."""

    model_config = ConfigDict(extra="ignore")

    request_id: StrictStr = Field(min_length=1, max_length=64)
    state: Literal[
        "accepted",
        "rejected",
        "downloading",
        "verifying",
        "installing",
        "rebooting",
        "succeeded",
        "failed",
        "rolled_back",
    ]
    progress: StrictInt | None = Field(default=None, ge=0, le=100)
    error: OtaStatusError | None = None
    running_version: StrictStr | None = Field(default=None, max_length=64)
    target_version: StrictStr | None = Field(default=None, max_length=64)


class OtaCheckPayload(BaseModel):
    """`ota/check` (device -> backend): is there a newer release?"""

    model_config = ConfigDict(extra="ignore")

    request_id: StrictStr = Field(min_length=1, max_length=64)
    running_version: StrictStr | None = Field(default=None, max_length=64)


class OtaRequestPayload(BaseModel):
    """`ota/request` (device -> backend): install this release."""

    model_config = ConfigDict(extra="ignore")

    request_id: StrictStr = Field(min_length=1, max_length=64)
    version: StrictStr = Field(min_length=1, max_length=64)
    running_version: StrictStr | None = Field(default=None, max_length=64)
