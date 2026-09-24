"""Standalone runtime for generic device MQTT ingestion.

This process keeps telemetry, event, and broker-presence handling separate from
``app.main``. It intentionally does not own schema/bootstrap work or expose the
administrative API.
"""

import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI

import app.core.model_registry  # noqa: F401  (resolves ORM relationships in this process)
from app.core.config import settings
from app.core.logging_config import quiet_http_client_logs
from app.core.mqtt.client import mqtt_client
from app.core.mqtt.handlers import (
    process_device_status_message,
    process_sensor_message_pub,
    process_sensor_message_sub,
    process_time_sync_request,
)

load_dotenv()

logging.basicConfig(level=logging.INFO)
quiet_http_client_logs()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    mqtt_client.start()
    mqtt_client.subscribe("iot/devices/+/telemetry", process_sensor_message_pub, qos=2)
    mqtt_client.subscribe("iot/devices/+/events", process_sensor_message_sub, qos=2)
    mqtt_client.subscribe("iot/devices/+/status", process_device_status_message, qos=1)
    mqtt_client.subscribe("iot/devices/+/time/request", process_time_sync_request, qos=1)

    logger.info("Generic MQTT runtime started")

    yield

    mqtt_client.stop()


app = FastAPI(
    title=f"{settings.PROJECT_NAME} - Device Runtime",
    lifespan=lifespan,
    openapi_url=None if settings.ENVIRONMENT == "PROD" else "/api/openapi.json",
    docs_url=None if settings.ENVIRONMENT == "PROD" else "/api/docs",
    redoc_url=None,
)


@app.get("/health")
def health_check():
    return {"status": "ok"}
