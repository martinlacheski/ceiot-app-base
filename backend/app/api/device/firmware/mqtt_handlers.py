"""MQTT handlers of the OTA topics the device publishes. Subscribed only in the device runtime
(`app.main_runtime`), so each message is processed exactly once."""

import json
import logging

from fastapi import HTTPException

from app.api.device.firmware.service import FirmwareService
from app.core.db import system_session
from app.core.mqtt.handlers import _decode_payload, _extract_serial_from_topic
from app.core.storage import ObjectStorage, get_storage

logger = logging.getLogger(__name__)


def _parse(kind: str, topic: str, payload) -> tuple[str, dict] | None:
    serial = _extract_serial_from_topic(topic)
    if not serial:
        logger.warning("%s ignored: invalid topic=%s", kind, topic)
        return None
    try:
        data = json.loads(_decode_payload(payload))
    except (TypeError, ValueError):
        logger.warning("%s ignored: invalid JSON payload serial=%s", kind, serial)
        return None
    if not isinstance(data, dict):
        logger.warning("%s ignored: payload is not an object serial=%s", kind, serial)
        return None
    return serial, data


def _optional_storage() -> ObjectStorage | None:
    """The object store, or None when it is not configured (the device is told `internal`)."""
    try:
        return get_storage()
    except HTTPException:
        return None


async def process_ota_status(topic: str, payload) -> None:
    """Topic: `iot/devices/{serial}/ota/status`. Unknown request ids, bad payloads and
    redeliveries are ignored (see `FirmwareService.apply_status`)."""
    parsed = _parse("ota/status", topic, payload)
    if parsed is None:
        return
    serial, data = parsed
    try:
        async with system_session() as session:
            await FirmwareService(session).apply_status(serial, data)
    except Exception:
        logger.exception("ota/status failed serial=%s", serial)


async def process_ota_check(topic: str, payload) -> None:
    """Topic: `iot/devices/{serial}/ota/check`: answers `ota/available` with the latest active release."""
    parsed = _parse("ota/check", topic, payload)
    if parsed is None:
        return
    serial, data = parsed
    try:
        async with system_session() as session:
            await FirmwareService(session).handle_check(serial, data)
    except Exception:
        logger.exception("ota/check failed serial=%s", serial)


async def process_ota_request(topic: str, payload) -> None:
    """Topic: `iot/devices/{serial}/ota/request`: creates the attempt and sends `ota/command`
    (or answers `ota/available` with an error)."""
    parsed = _parse("ota/request", topic, payload)
    if parsed is None:
        return
    serial, data = parsed
    try:
        async with system_session() as session:
            await FirmwareService(session, _optional_storage()).handle_request(serial, data)
    except Exception:
        logger.exception("ota/request failed serial=%s", serial)
