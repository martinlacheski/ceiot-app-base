"""Admin-only device emulator.

Lets an admin publish synthetic telemetry or a time-sync request for a real
device through the backend's own MQTT client (the browser never touches the
broker directly: no device certificate or broker credential is exposed to
the frontend). Data flows through the same path as a real device:
broker -> mqtt-runtime -> validation -> DB, so emulated readings are
indistinguishable from real ones once ingested.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.auth.models import User
from app.api.device.models import Device
from app.api.device.repository import DeviceRepository
from app.api.sensor.repository import SensorRepository
from app.api.sensor.service import validate_sensor_values
from app.core.dependencies import AuthedAsyncDBSession, get_current_user
from app.core.mqtt.client import get_mqtt_client
from app.core.utils import CamelModel

router = APIRouter()


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo administradores pueden usar el emulador de dispositivos",
        )
    return current_user


class EmulatorTelemetryRequest(CamelModel):
    sensors: dict[str, dict[str, float]]
    uptime: int | None = None
    firmware_version: str = "emulador"


class EmulatorTelemetryResponse(CamelModel):
    topic: str
    payload: dict[str, Any]


class EmulatorTimeRequestResponse(CamelModel):
    req_id: str
    topic: str


async def _get_emulatable_device(device_id: uuid.UUID, session: AuthedAsyncDBSession) -> Device:
    device = await DeviceRepository(session).get(device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo no encontrado")
    if not (device.enabled and device.is_active):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="El dispositivo no está habilitado; no se puede emular",
        )
    return device


@router.post(
    "/{device_id}/emulator/telemetry",
    response_model=EmulatorTelemetryResponse,
    dependencies=[Depends(require_admin)],
    tags=["Device Emulator"],
)
async def emulate_device_telemetry(
    device_id: uuid.UUID,
    body: EmulatorTelemetryRequest,
    session: AuthedAsyncDBSession,
) -> EmulatorTelemetryResponse:
    device = await _get_emulatable_device(device_id, session)

    capabilities = await SensorRepository(session).get_active_sensor_capabilities(device.id)
    if not capabilities:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="El dispositivo no tiene sensores activos instalados",
        )

    # Same drop-invalid-keep-valid validation the real ingestion path uses
    # (app.api.sensor.service.validate_sensor_values), so an emulated
    # payload can never claim a sensor/variable the device doesn't actually
    # have installed.
    valid_sensors = validate_sensor_values(body.sensors, capabilities)
    if not valid_sensors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Ninguna de las mediciones enviadas corresponde a sensores o "
                "variables activos instalados en este dispositivo, o los "
                "valores están fuera de rango"
            ),
        )

    payload: dict[str, Any] = {
        "sensors": valid_sensors,
        "firmware_version": body.firmware_version,
    }
    if body.uptime is not None:
        payload["uptime"] = body.uptime

    topic = f"iot/devices/{device.serial}/telemetry"
    get_mqtt_client().publish(topic, payload, qos=1, retain=False)
    return EmulatorTelemetryResponse(topic=topic, payload=payload)


@router.post(
    "/{device_id}/emulator/time-request",
    response_model=EmulatorTimeRequestResponse,
    dependencies=[Depends(require_admin)],
    tags=["Device Emulator"],
)
async def emulate_device_time_request(
    device_id: uuid.UUID,
    session: AuthedAsyncDBSession,
) -> EmulatorTimeRequestResponse:
    device = await _get_emulatable_device(device_id, session)

    req_id = uuid.uuid4().hex[:16]
    topic = f"iot/devices/{device.serial}/time/request"
    get_mqtt_client().publish(topic, {"req_id": req_id}, qos=1, retain=False)
    return EmulatorTimeRequestResponse(req_id=req_id, topic=topic)
