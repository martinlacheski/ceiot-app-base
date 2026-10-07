"""Pure rules of the firmware catalog: what an uploaded image and a version must look like."""

import re
import struct
from dataclasses import dataclass

# The OTA app partitions in esp32/partitions.csv (`ota_0`/`ota_1`) are 0x400000 bytes each: an
# image larger than that cannot be written by the device. Keep both in sync.
MAX_IMAGE_BYTES = 0x400000
# First byte of every ESP app image (`ESP_IMAGE_HEADER_MAGIC`).
ESP_IMAGE_MAGIC = 0xE9
# Magic byte + segment count + SPI mode/speed + entry point + extended header: a real image is
# far larger; anything under this is not an image.
MIN_IMAGE_BYTES = 24
# `project(...)` in esp32/CMakeLists.txt: the only firmware this platform installs.
FIRMWARE_PROJECT = "iot_device"

# `esp_app_desc_t.version` is char[32].
_VERSION = re.compile(r"[A-Za-z0-9._+-]{1,32}")


class FirmwareValidationError(ValueError):
    """The upload cannot be a firmware release; the message is shown to the admin (Spanish)."""


def validate_image(data: bytes) -> None:
    if len(data) < MIN_IMAGE_BYTES:
        raise FirmwareValidationError("El archivo no es una imagen de firmware válida.")
    if len(data) > MAX_IMAGE_BYTES:
        raise FirmwareValidationError(
            f"El tamaño de la imagen supera la partición OTA ({MAX_IMAGE_BYTES} bytes)."
        )
    if data[0] != ESP_IMAGE_MAGIC:
        raise FirmwareValidationError(
            "El archivo no es una imagen de aplicación ESP (falta el byte mágico 0xE9)."
        )


def validate_version(version: str) -> str:
    cleaned = version.strip()
    if _VERSION.fullmatch(cleaned) is None:
        raise FirmwareValidationError(
            "La versión debe tener entre 1 y 32 caracteres: letras, números, '.', '_', '+' o '-'."
        )
    return cleaned


# `esp_app_desc_t` follows the 24-byte image header and the first 8-byte segment header
# (`esp_app_format.h`): magic word u32, secure_version u32, reserv1[2] u32, then NUL-terminated
# version[32], project_name[32], time[16], date[16], idf_ver[32].
APP_DESC_OFFSET = 32
APP_DESC_MAGIC = 0xABCD5432
_APP_DESC_FIELDS = ((48, 32), (80, 32), (112, 16), (128, 16), (144, 32))
_APP_DESC_END = 176


@dataclass(frozen=True)
class AppDescriptor:
    version: str
    project_name: str
    build_time: str
    build_date: str
    idf_version: str


def parse_app_descriptor(data: bytes) -> AppDescriptor:
    magic = struct.unpack_from("<I", data, APP_DESC_OFFSET)[0] if len(data) >= _APP_DESC_END else None
    if magic != APP_DESC_MAGIC:
        raise FirmwareValidationError(
            "El archivo no es un firmware ESP32 válido (falta el descriptor de la aplicación)."
        )
    version, project, build_time, build_date, idf = (
        data[offset : offset + width].split(b"\0", 1)[0].decode("utf-8", "replace").strip()
        for offset, width in _APP_DESC_FIELDS
    )
    return AppDescriptor(version, project, build_time, build_date, idf)
