"""S2 MQTT payload validation and persistence regressions."""

import json
import logging
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from sqlmodel import select

from app.api.device.repository import DeviceRepository
from app.api.sensor.models import SensorReading, Telemetry
from app.api.sensor.repository import SensorRepository
from app.api.sensor.service import SensorService, validate_sensor_values
from app.api.sensor_catalog.models import DeviceSensor, Sensor, SensorVariable, Variable
from app.core.mqtt import handlers


pytestmark = pytest.mark.asyncio


CAPABILITIES = [
    ("dht11", "temperature", 0, 50),
    ("dht11", "relative_humidity", 20, 90),
    ("dht22", "temperature", -40, 80),
    ("dht22", "relative_humidity", 0, 100),
    ("bmp280", "temperature", -40, 85),
    ("bmp280", "pressure", 300, 1100),
]


async def test_validator_drops_unknown_inactive_and_unmeasured_values(caplog):
    with caplog.at_level(logging.WARNING):
        result = validate_sensor_values(
            {
                "missing": {"temperature": 21},
                "retired": {"temperature": 21},
                "dht22": {"pressure": 1012, "temperature": 23.4},
            },
            CAPABILITIES,
        )
    assert result == {"dht22": {"temperature": 23.4}}
    assert "missing" in caplog.text
    assert "retired" in caplog.text
    assert "pressure" in caplog.text


async def test_validator_uses_per_model_ranges_and_keeps_partial_values(caplog):
    with caplog.at_level(logging.WARNING):
        result = validate_sensor_values(
            {
                "dht11": {"temperature": 60, "relative_humidity": 55.1},
                "dht22": {"temperature": 60, "relative_humidity": True},
                "bmp280": {"temperature": float("nan"), "pressure": "1012.6"},
            },
            CAPABILITIES,
        )
    assert result == {
        "dht11": {"relative_humidity": 55.1},
        "dht22": {"temperature": 60},
    }
    assert "temperature" in caplog.text
    assert "relative_humidity" in caplog.text
    assert "pressure" in caplog.text


async def test_validator_rejects_infinities_and_malformed_shapes():
    assert validate_sensor_values({"dht22": {"temperature": float("inf")}}, CAPABILITIES) == {}
    assert validate_sensor_values({"dht22": {"temperature": float("-inf")}}, CAPABILITIES) == {}
    assert validate_sensor_values({"dht22": {"temperature": 10**1000}}, CAPABILITIES) == {}
    assert validate_sensor_values({"dht22": [23.4]}, CAPABILITIES) == {}
    assert validate_sensor_values([23.4], CAPABILITIES) == {}


async def test_capability_lookup_is_one_query_and_excludes_inactive_sensors(engine, async_session, monkeypatch):
    del engine
    device_id = uuid.uuid4()
    variable = Variable(code="test_temperature", name="Temperature", unit="°C")
    active_model = Sensor(code="test_dht22", name="DHT22", manufacturer="Test")
    inactive_model = Sensor(code="test_dht11", name="DHT11", manufacturer="Test")
    async_session.add_all([variable, active_model, inactive_model])
    await async_session.flush()
    async_session.add_all([
        SensorVariable(sensor_id=active_model.id, variable_id=variable.id, min_value=-40, max_value=80, accuracy="1", resolution="1"),
        SensorVariable(sensor_id=inactive_model.id, variable_id=variable.id, min_value=0, max_value=50, accuracy="1", resolution="1"),
        DeviceSensor(device_id=device_id, sensor_id=active_model.id, key="dht22"),
        DeviceSensor(device_id=device_id, sensor_id=inactive_model.id, key="dht11", is_active=False),
    ])
    await async_session.commit()

    execute = async_session.execute
    calls = 0

    async def counting_execute(statement, *args, **kwargs):
        nonlocal calls
        calls += 1
        return await execute(statement, *args, **kwargs)

    monkeypatch.setattr(async_session, "execute", counting_execute)
    capabilities = await SensorRepository(async_session).get_active_sensor_capabilities(device_id)
    assert calls == 1
    assert capabilities == [("dht22", "test_temperature", -40, 80)]


@pytest.fixture
def mqtt_context(monkeypatch, engine, async_session):
    del engine
    device_id = uuid.uuid4()

    @asynccontextmanager
    async def test_system_session():
        yield async_session

    async def get_by_serial(self, serial):
        return SimpleNamespace(id=device_id, serial=serial)

    async def register_runtime_report(self, *args, **kwargs):
        return None

    async def capabilities(self, device_id_arg):
        assert device_id_arg == device_id
        return CAPABILITIES

    monkeypatch.setattr(handlers, "system_session", test_system_session)
    monkeypatch.setattr(DeviceRepository, "get_by_serial", get_by_serial)
    monkeypatch.setattr(DeviceRepository, "register_runtime_report", register_runtime_report)
    monkeypatch.setattr(SensorRepository, "get_active_sensor_capabilities", capabilities)
    return device_id


async def test_handler_writes_only_valid_values_and_health(async_session, mqtt_context):
    serial = "S2-VALID-001"
    await handlers.process_sensor_message_pub(
        f"iot/devices/{serial}/telemetry",
        json.dumps({
            "sensors": {
                "dht22": {"temperature": 23.4, "relative_humidity": True},
                "bmp280": {"pressure": 1012.6},
                "missing": {"temperature": 19},
            },
            "uptime": 120,
            "firmware_version": "1.2.3",
        }),
    )
    telemetry = list((await async_session.exec(select(Telemetry).where(Telemetry.device_serial == serial))).all())
    readings = list((await async_session.exec(select(SensorReading).where(SensorReading.device_serial == serial))).all())
    assert len(telemetry) == 1
    assert telemetry[0].device_id == mqtt_context
    assert telemetry[0].values == {"dht22": {"temperature": 23.4}, "bmp280": {"pressure": 1012.6}}
    assert len(readings) == 1
    assert readings[0].uptime == 120
    assert readings[0].firmware_version == "1.2.3"
    assert not readings[0].extra_data or "sensors" not in readings[0].extra_data


async def test_handler_does_not_write_all_invalid_telemetry_but_keeps_health(async_session, mqtt_context):
    serial = "S2-INVALID-001"
    await handlers.process_sensor_message_pub(
        f"iot/devices/{serial}/telemetry",
        json.dumps({"sensors": {"dht11": {"temperature": 60}, "missing": {"pressure": 900}}, "uptime": 42}),
    )
    assert not (await async_session.exec(select(Telemetry).where(Telemetry.device_serial == serial))).all()
    readings = (await async_session.exec(select(SensorReading).where(SensorReading.device_serial == serial))).all()
    assert len(readings) == 1 and readings[0].uptime == 42


async def test_handler_preserves_old_flat_payload(async_session, mqtt_context):
    serial = "S2-LEGACY-001"
    await handlers.process_sensor_message_pub(
        f"iot/devices/{serial}/telemetry",
        json.dumps({"temperature": 21.5, "humidity": 44, "pressure": 1000}),
    )
    assert not (await async_session.exec(select(Telemetry).where(Telemetry.device_serial == serial))).all()
    readings = (await async_session.exec(select(SensorReading).where(SensorReading.device_serial == serial))).all()
    assert len(readings) == 1
    assert (readings[0].temperature_c, readings[0].relative_humidity_pct, readings[0].pressure_hpa) == (21.5, 44, 1000)


async def test_telemetry_failure_does_not_lose_committed_health(async_session, mqtt_context, monkeypatch, caplog):
    async def fail_telemetry(self, **kwargs):
        raise RuntimeError("capability lookup failed")

    monkeypatch.setattr(SensorService, "save_sensor_telemetry", fail_telemetry)
    serial = "S2-FAIL-001"
    with caplog.at_level(logging.ERROR):
        await handlers.process_sensor_message_pub(
            f"iot/devices/{serial}/telemetry",
            json.dumps({"sensors": {"dht22": {"temperature": 23}}, "uptime": 54}),
        )
    readings = (await async_session.exec(select(SensorReading).where(SensorReading.device_serial == serial))).all()
    assert len(readings) == 1 and readings[0].uptime == 54
    assert "Failed to ingest sensor-key telemetry" in caplog.text
