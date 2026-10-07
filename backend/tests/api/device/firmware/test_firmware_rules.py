"""Pure rules of the firmware catalog: what an uploaded image and a version must look like."""

import pytest

from app.api.device.firmware.rules import (
    FIRMWARE_PROJECT,
    MAX_IMAGE_BYTES,
    FirmwareValidationError,
    parse_app_descriptor,
    validate_image,
    validate_version,
)
from tests.api.device.firmware.support import esp_image


def test_an_esp_app_image_is_accepted():
    validate_image(esp_image(2048))


def test_the_largest_image_that_fits_the_ota_partition_is_accepted():
    # esp32/partitions.csv: ota_0 and ota_1 are 0x400000 bytes each.
    assert MAX_IMAGE_BYTES == 0x400000
    validate_image(esp_image(MAX_IMAGE_BYTES))


@pytest.mark.parametrize("first_byte", [0x00, 0x7F, 0xE8, 0xEA, 0xFF])
def test_an_image_without_the_esp_magic_byte_is_rejected(first_byte):
    with pytest.raises(FirmwareValidationError, match="imagen"):
        validate_image(esp_image(2048, first_byte=first_byte))


def test_an_empty_or_tiny_file_is_rejected():
    with pytest.raises(FirmwareValidationError):
        validate_image(b"")
    with pytest.raises(FirmwareValidationError):
        validate_image(b"\xe9")


def test_an_image_larger_than_the_ota_partition_is_rejected():
    with pytest.raises(FirmwareValidationError, match="tamaño"):
        validate_image(esp_image(MAX_IMAGE_BYTES + 1))


@pytest.mark.parametrize("version", ["1.2.0", "v1.0.0-rc1", "a_b+c.1", "X" * 32])
def test_a_plain_version_string_is_accepted(version):
    assert validate_version(version) == version


@pytest.mark.parametrize("version", ["", "  ", "a b", "x/y", "../1", "é1", "X" * 33])
def test_a_version_that_is_not_a_plain_token_is_rejected(version):
    with pytest.raises(FirmwareValidationError):
        validate_version(version)


def test_a_version_is_trimmed_before_it_is_checked():
    assert validate_version("  1.2.0 ") == "1.2.0"


def test_the_app_descriptor_is_read_from_the_image():
    descriptor = parse_app_descriptor(esp_image(2048))
    assert descriptor.version == "1.2.0"
    assert descriptor.project_name == FIRMWARE_PROJECT == "iot_device"
    assert descriptor.build_time == "14:32:05"
    assert descriptor.build_date == "Oct  6 2026"
    assert descriptor.idf_version == "v5.3"


def test_an_image_without_the_descriptor_magic_word_is_rejected():
    with pytest.raises(FirmwareValidationError, match="descriptor"):
        parse_app_descriptor(esp_image(2048, magic=0x12345678))


def test_an_image_too_short_to_hold_the_descriptor_is_rejected():
    with pytest.raises(FirmwareValidationError, match="descriptor"):
        parse_app_descriptor(esp_image(2048)[:100])
