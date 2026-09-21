import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import timedelta

import pytest
from sqlmodel import select

from app.api.sensor.models import SensorReading
from app.api.sensor.repository import SensorRepository
from app.core.mqtt import handlers
from app.core.time import utc_now


pytestmark = pytest.mark.asyncio


def _use_test_session(monkeypatch, async_session) -> None:
    @asynccontextmanager
    async def test_system_session():
        yield async_session

    monkeypatch.setattr(handlers, "system_session", test_system_session)


async def _readings(async_session, serial: str) -> list[SensorReading]:
    result = await async_session.exec(
        select(SensorReading).where(SensorReading.device_serial == serial)
    )
    return list(result.all())


async def test_valid_environmental_payload_persists_explicit_columns_only(
    engine,
    async_session,
    monkeypatch,
) -> None:
    del engine
    _use_test_session(monkeypatch, async_session)
    serial = "IOT-ENV0-0001"

    await handlers.process_sensor_message_pub(
        f"iot/devices/{serial}/telemetry",
        json.dumps(
            {
                "temperature": 23.75,
                "humidity": 48.5,
                "pressure": 1007.2,
                "sample_source": "synthetic",
            }
        ),
    )

    readings = await _readings(async_session, serial)
    assert len(readings) == 1
    reading = readings[0]
    assert reading.temperature_c == pytest.approx(23.75)
    assert reading.relative_humidity_pct == pytest.approx(48.5)
    assert reading.pressure_hpa == pytest.approx(1007.2)
    assert reading.extra_data == {"sample_source": "synthetic"}


async def test_bad_environmental_values_persist_as_null_and_warn(
    engine,
    async_session,
    monkeypatch,
    caplog,
) -> None:
    del engine
    _use_test_session(monkeypatch, async_session)
    serial = "IOT-ENV0-0002"
    payloads = (
        {"temperature": "hot", "humidity": True, "pressure": {"hpa": 900}},
        {"temperature": -40.1, "humidity": 100.1, "pressure": 299.9},
        {
            "temperature": float("nan"),
            "humidity": float("inf"),
            "pressure": float("-inf"),
        },
    )

    with caplog.at_level(logging.WARNING):
        for payload in payloads:
            await handlers.process_sensor_message_pub(
                f"iot/devices/{serial}/telemetry",
                json.dumps(payload),
            )

    readings = await _readings(async_session, serial)
    assert len(readings) == len(payloads)
    assert all(reading.temperature_c is None for reading in readings)
    assert all(reading.relative_humidity_pct is None for reading in readings)
    assert all(reading.pressure_hpa is None for reading in readings)
    assert sum(record.levelno == logging.WARNING for record in caplog.records) >= 9
    assert not [record for record in caplog.records if record.levelno >= logging.ERROR]


async def test_missing_environmental_keys_persist_as_null(
    engine,
    async_session,
    monkeypatch,
) -> None:
    del engine
    _use_test_session(monkeypatch, async_session)
    serial = "IOT-ENV0-0003"

    await handlers.process_sensor_message_pub(
        f"iot/devices/{serial}/telemetry",
        json.dumps({"uptime": 120}),
    )

    readings = await _readings(async_session, serial)
    assert len(readings) == 1
    reading = readings[0]
    assert reading.uptime == 120
    assert reading.temperature_c is None
    assert reading.relative_humidity_pct is None
    assert reading.pressure_hpa is None


async def test_duplicate_and_out_of_order_times_have_deterministic_ordering(
    engine,
    async_session,
) -> None:
    del engine
    serial = "IOT-ENV0-0004"
    repository = SensorRepository(async_session)
    now = utc_now()
    earlier = now - timedelta(minutes=10)
    duplicate_time = now - timedelta(minutes=5)
    readings = (
        SensorReading(
            id=uuid.UUID(int=3),
            time=duplicate_time,
            device_serial=serial,
            temperature_c=23.0,
        ),
        SensorReading(
            id=uuid.UUID(int=1),
            time=earlier,
            device_serial=serial,
            temperature_c=21.0,
        ),
        SensorReading(
            id=uuid.UUID(int=2),
            time=duplicate_time,
            device_serial=serial,
            temperature_c=22.0,
        ),
    )
    for reading in readings:
        await repository.create(reading)

    latest = await repository.get_latest_by_device(serial)
    recent = await repository.get_recent_readings(serial, hours=1)

    assert [reading.id for reading in latest] == [
        uuid.UUID(int=3),
        uuid.UUID(int=2),
        uuid.UUID(int=1),
    ]
    assert [reading.id for reading in recent] == [
        uuid.UUID(int=1),
        uuid.UUID(int=2),
        uuid.UUID(int=3),
    ]
