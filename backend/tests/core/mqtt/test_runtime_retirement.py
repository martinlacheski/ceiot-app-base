"""Protected contracts for retiring the remaining payment runtime.

The composition checks inspect source instead of importing either FastAPI
entrypoint. Handler behavior runs only against in-memory repository, session,
sensor, and publisher doubles installed before each call.
"""

from __future__ import annotations

import ast
from importlib import import_module
import logging
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.core.mqtt import handlers
from app.api.device.service import DeviceService


pytest: Any = import_module("pytest")


BACKEND_ROOT = Path(__file__).resolve().parents[3]
APP_ROOT = BACKEND_ROOT / "app"
MAIN_PATH = APP_ROOT / "main.py"
RUNTIME_PATH = APP_ROOT / "main_runtime.py"
HANDLERS_PATH = APP_ROOT / "core" / "mqtt" / "handlers.py"
CLIENT_PATH = APP_ROOT / "core" / "mqtt" / "client.py"
CONFIG_PATH = APP_ROOT / "core" / "config.py"
REQUIREMENTS_PATH = BACKEND_ROOT / "requirements.txt"

EXPECTED_RUNTIME_SUBSCRIPTIONS = {
    ("iot/devices/+/telemetry", "process_sensor_message_pub", 2),
    ("iot/devices/+/events", "process_sensor_message_sub", 2),
    ("iot/devices/+/status", "process_device_status_message", 1),
    ("iot/devices/+/time/request", "process_time_sync_request", 1),
}

RETIRED_EXECUTABLE_PATHS = (
    "app/api/mercadopago/service.py",
    "app/api/mercadopago/repository.py",
    "app/api/mercadopago/schemas.py",
    "app/api/mercadopago/webhook_handler.py",
    "app/api/mercadopago/refund_worker.py",
    "app/api/mercadopago/init_point_orchestrator.py",
    "app/api/mercadopago/init_point_strategy.py",
    "app/core/security/encryption.py",
    "app/api/mercadopago/location_catalog/repository.py",
    "app/api/mercadopago/location_catalog/service.py",
    "app/api/mercadopago/location_catalog/seed.py",
    "app/api/mercadopago/location_catalog/data/mercadopago_locations_ar.v1.json",
    "tests/core/mqtt/test_handlers_init_point.py",
    "tests/api/mercadopago/test_admin_service.py",
    "tests/api/mercadopago/test_init_point_orchestrator.py",
    "tests/api/mercadopago/test_init_point_strategy.py",
    "tests/api/mercadopago/test_service_marketplace.py",
    "tests/api/mercadopago/test_service_payment_creation_gate.py",
    "tests/api/mercadopago/test_service_payment_persistence.py",
    "tests/api/mercadopago/test_service_refunds.py",
    "tests/api/mercadopago/test_service_store_creation.py",
    "tests/api/mercadopago/test_webhook_handler_qr.py",
)

# SCHEMA1 (see odd/tasks/environmental-iot-cleanup.md) superseded the earlier
# retained-history policy with explicit user authorization to fully remove the
# legacy Mercado Pago schema, including these historical models -- they are no
# longer expected to remain.


def _tree(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _function(tree: ast.Module, name: str) -> ast.FunctionDef | ast.AsyncFunctionDef:
    matches = [
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
    ]
    assert len(matches) == 1, f"Expected exactly one public function named {name}."
    return matches[0]


def _class(tree: ast.Module, name: str) -> ast.ClassDef:
    matches = [
        node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == name
    ]
    assert len(matches) == 1, f"Expected exactly one public class named {name}."
    return matches[0]


def _attribute_calls(node: ast.AST, attribute: str) -> list[ast.Call]:
    return [
        child
        for child in ast.walk(node)
        if isinstance(child, ast.Call)
        and isinstance(child.func, ast.Attribute)
        and child.func.attr == attribute
    ]


def _route_paths(tree: ast.Module) -> set[tuple[str, str]]:
    routes: set[tuple[str, str]] = set()
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if (
                isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and decorator.func.attr in {"get", "post", "put", "patch", "delete"}
                and decorator.args
                and isinstance(decorator.args[0], ast.Constant)
                and isinstance(decorator.args[0].value, str)
            ):
                routes.add((decorator.func.attr, decorator.args[0].value))
    return routes


def _imported_modules(tree: ast.Module) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules


def _top_level_names(tree: ast.Module) -> set[str]:
    return {
        node.name
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    }


def _settings_field_names(tree: ast.Module) -> set[str]:
    settings_class = _class(tree, "Settings")
    return {
        node.target.id
        for node in settings_class.body
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
    }


def test_deployed_main_remains_publisher_only() -> None:
    tree = _tree(MAIN_PATH)
    lifespan = _function(tree, "lifespan")

    assert _attribute_calls(lifespan, "subscribe") == []
    assert len(_attribute_calls(lifespan, "start")) == 1
    assert len(_attribute_calls(lifespan, "stop")) == 1
    assert ("get", "/health") in _route_paths(tree)


def test_mqtt_client_defaults_empty_and_connects_only_registered_callbacks() -> None:
    tree = _tree(CLIENT_PATH)
    client_class = _class(tree, "MQTTClient")
    initializer = next(
        node
        for node in client_class.body
        if isinstance(node, ast.FunctionDef) and node.name == "__init__"
    )
    callback_assignments = [
        node
        for node in ast.walk(initializer)
        if (
            isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Attribute) and target.attr == "callbacks"
                for target in node.targets
            )
        )
        or (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Attribute)
            and node.target.attr == "callbacks"
        )
    ]
    assert len(callback_assignments) == 1
    assert isinstance(callback_assignments[0].value, ast.Dict)
    assert callback_assignments[0].value.keys == []

    on_connect = next(
        node
        for node in client_class.body
        if isinstance(node, ast.FunctionDef) and node.name == "on_connect"
    )
    subscribe_calls = _attribute_calls(on_connect, "subscribe")
    assert len(subscribe_calls) == 1
    assert any(
        isinstance(node, ast.For)
        and isinstance(node.iter, ast.Call)
        and isinstance(node.iter.func, ast.Attribute)
        and node.iter.func.attr == "items"
        and isinstance(node.iter.func.value, ast.Attribute)
        and node.iter.func.value.attr == "callbacks"
        for node in ast.walk(on_connect)
    )


def test_standalone_runtime_keeps_only_four_generic_subscriptions() -> None:
    tree = _tree(RUNTIME_PATH)
    lifespan = _function(tree, "lifespan")
    observed: set[tuple[str, str, int]] = set()

    for call in _attribute_calls(lifespan, "subscribe"):
        assert len(call.args) >= 2
        topic_node, callback_node = call.args[:2]
        qos_nodes = [keyword.value for keyword in call.keywords if keyword.arg == "qos"]
        assert isinstance(topic_node, ast.Constant) and isinstance(topic_node.value, str)
        assert isinstance(callback_node, ast.Name)
        assert len(qos_nodes) == 1 and isinstance(qos_nodes[0], ast.Constant)
        qos_value = qos_nodes[0].value
        assert isinstance(qos_value, int)
        observed.add((topic_node.value, callback_node.id, qos_value))

    assert observed == EXPECTED_RUNTIME_SUBSCRIPTIONS
    assert len(_attribute_calls(lifespan, "start")) == 1
    assert len(_attribute_calls(lifespan, "stop")) == 1


def test_device_serials_use_the_neutral_iot_prefix() -> None:
    serial = DeviceService.generate_serial()

    assert serial.startswith("IOT-")
    assert len(serial) == 13
    assert DeviceService.validate_serial(serial)
    assert DeviceService.normalize_serial("iot7m9k2fq8") == "IOT-7M9K-2FQ8"
    assert not DeviceService.validate_serial("DVEM-7M9K-2FQ8")


def test_standalone_runtime_retains_fastapi_docs_and_health_without_finance() -> None:
    tree = _tree(RUNTIME_PATH)
    imports = _imported_modules(tree)
    fastapi_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "FastAPI"
    ]

    assert len(fastapi_calls) == 1
    assert {keyword.arg for keyword in fastapi_calls[0].keywords} >= {
        "title",
        "lifespan",
        "openapi_url",
        "docs_url",
        "redoc_url",
    }
    assert ("get", "/health") in _route_paths(tree)
    assert all(not module.startswith("app.api.mercadopago") for module in imports)
    assert all("mercadopago" not in path for _method, path in _route_paths(tree))


def test_handlers_expose_only_generic_mqtt_entrypoints() -> None:
    tree = _tree(HANDLERS_PATH)
    names = _top_level_names(tree)
    imports = _imported_modules(tree)

    assert {
        "process_sensor_message_pub",
        "process_sensor_message_sub",
        "process_device_status_message",
        "process_time_sync_request",
    } <= names
    assert {
        "process_init_point_request",
        "process_nfc_url_request",
        "_resolve_owner_id",
        "_save_init_point_sensor_data",
        "_is_expendedora_device",
    }.isdisjoint(names)
    assert all(not module.startswith("app.api.mercadopago") for module in imports)


class _FakeSessionContext:
    def __init__(self, session: object) -> None:
        self.session = session

    async def __aenter__(self) -> object:
        return self.session

    async def __aexit__(self, *_args: object) -> bool:
        return False


@pytest.fixture
def isolated_handler_boundaries(monkeypatch: Any) -> dict[str, Any]:
    state: dict[str, Any] = {
        "operations": [],
        "runtime_reports": [],
        "sensor_readings": [],
        "presence_updates": [],
        "published": [],
    }
    device = SimpleNamespace(
        id="synthetic-device-id",
        serial="SYNTHETIC-1000",
        environment_id=None,
        broker_connected=None,
        type=SimpleNamespace(code="relay_1"),
    )

    class FakeDeviceRepository:
        def __init__(self, _session: object) -> None:
            pass

        async def get_by_serial(self, serial: str) -> object | None:
            return device if serial == device.serial else None

        async def register_runtime_report(
            self, reported_device: Any, **fields: object
        ) -> None:
            state["runtime_reports"].append(
                {"device_id": reported_device.id, **fields}
            )

        async def update_broker_presence(
            self, serial: str, broker_connected: bool
        ) -> object | None:
            state["presence_updates"].append((serial, broker_connected))
            if serial != device.serial:
                return None
            device.broker_connected = broker_connected
            return device

    class FakeDeviceOperationService:
        def __init__(self, _session: object) -> None:
            pass

        async def create_operation(self, **fields: object) -> object:
            state["operations"].append(fields)
            return SimpleNamespace(**fields)

    class FakeSensorRepository:
        def __init__(self, _session: object) -> None:
            pass

    class FakeSensorService:
        def __init__(self, _repository: object) -> None:
            pass

        async def save_reading(self, **fields: object) -> object:
            state["sensor_readings"].append(fields)
            return SimpleNamespace(**fields)

    class FakeMqttClient:
        def publish(self, topic: str, message: object, qos: int = 1) -> None:
            state["published"].append((topic, message, qos))

    sensor_repository_module = types.ModuleType("app.api.sensor.repository")
    sensor_repository_module.__dict__["SensorRepository"] = FakeSensorRepository
    sensor_service_module = types.ModuleType("app.api.sensor.service")
    sensor_service_module.__dict__["SensorService"] = FakeSensorService
    mqtt_client_module = types.ModuleType("app.core.mqtt.client")
    mqtt_client_module.__dict__["mqtt_client"] = FakeMqttClient()

    monkeypatch.setitem(sys.modules, "app.api.sensor.repository", sensor_repository_module)
    monkeypatch.setitem(sys.modules, "app.api.sensor.service", sensor_service_module)
    monkeypatch.setitem(sys.modules, "app.core.mqtt.client", mqtt_client_module)
    monkeypatch.setattr(handlers, "system_session", lambda: _FakeSessionContext(object()))
    monkeypatch.setattr(handlers, "DeviceRepository", FakeDeviceRepository)
    monkeypatch.setattr(
        handlers, "DeviceOperationService", FakeDeviceOperationService
    )

    state["device"] = device
    return state


@pytest.mark.asyncio
async def test_flat_environmental_keys_warn_and_still_persist_runtime_and_health(
    isolated_handler_boundaries: dict[str, Any],
    caplog: pytest.LogCaptureFixture,
) -> None:
    """S6: flat temperature/humidity keys (no 'sensors' payload) are no
    longer environmental data -- they get a clear warning and are dropped --
    but runtime/health reporting and the health reading keep working."""
    with caplog.at_level(logging.WARNING):
        await handlers.process_sensor_message_pub(
            "iot/devices/SYNTHETIC-1000/telemetry",
            '{"temperature": 21.5, "humidity": 55.0, "power_supply_state": true, '
            '"mac_address": "AA:BB:CC:DD:EE:FF", "firmware_version": "test-fw", '
            '"wifi_ip": "192.0.2.10", "wifi_rssi": -48, "wifi_ssid": "test-net", '
            '"reset_reason": "synthetic", "uptime": 120}',
        )

    reports = isolated_handler_boundaries["runtime_reports"]
    assert len(reports) == 1
    assert reports[0] == {
        "device_id": "synthetic-device-id",
        "mac_address": "AA:BB:CC:DD:EE:FF",
        "firmware_version": "test-fw",
        "ip_address": "192.0.2.10",
        "rssi": -48,
        "wifi_ssid": "test-net",
        "last_reset_reason": "synthetic",
        "gps_latitude": None,
        "gps_longitude": None,
        "gps_updated_at": None,
        "touch_last_connection": True,
    }
    # No 'sensors' payload was sent, so this is not real sensor telemetry.
    operations = isolated_handler_boundaries["operations"]
    assert len(operations) == 1
    assert operations[0]["operation_type"] == handlers.DeviceOperationType.KEEP_ACTIVE
    readings = isolated_handler_boundaries["sensor_readings"]
    assert len(readings) == 1
    assert readings[0]["device_serial"] == "SYNTHETIC-1000"
    assert readings[0]["device_id"] == "synthetic-device-id"
    assert "temperature_c" not in readings[0]
    assert "relative_humidity_pct" not in readings[0]
    assert readings[0]["power_supply_state"] is True
    assert readings[0]["uptime"] == 120
    assert any("sensors" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_generic_runtime_report_records_keep_active(
    isolated_handler_boundaries: dict[str, Any],
) -> None:
    await handlers.process_sensor_message_pub(
        "iot/devices/SYNTHETIC-1000/telemetry",
        '{"firmware_version": "test-fw", "wifi_rssi": -50}',
    )

    assert len(isolated_handler_boundaries["runtime_reports"]) == 1
    operations = isolated_handler_boundaries["operations"]
    assert len(operations) == 1
    assert operations[0]["operation_type"] == handlers.DeviceOperationType.KEEP_ACTIVE
    # A pure health ping still records a reading (S6: environmental fields no
    # longer exist on SensorReading at all -- they live only in `telemetry`).
    readings = isolated_handler_boundaries["sensor_readings"]
    assert len(readings) == 1
    assert "temperature_c" not in readings[0]
    assert "relative_humidity_pct" not in readings[0]
    assert "pressure_hpa" not in readings[0]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("payload", "expected_connected"),
    [("online", True), ('{"status": "offline"}', False)],
)
async def test_status_updates_broker_presence(
    isolated_handler_boundaries: dict[str, Any],
    payload: str,
    expected_connected: bool,
) -> None:
    await handlers.process_device_status_message(
        "iot/devices/SYNTHETIC-1000/status", payload
    )

    assert isolated_handler_boundaries["presence_updates"] == [
        ("SYNTHETIC-1000", expected_connected)
    ]
    assert (
        isolated_handler_boundaries["device"].broker_connected
        is expected_connected
    )


@pytest.mark.asyncio
async def test_dispense_ack_has_no_operation_or_reply(
    isolated_handler_boundaries: dict[str, Any],
) -> None:
    await handlers.process_sensor_message_pub(
        "iot/devices/SYNTHETIC-1000/telemetry",
        '{"command": "DISPENSE_ACK", "serial": "SYNTHETIC-1000"}',
    )

    assert isolated_handler_boundaries["operations"] == []
    assert isolated_handler_boundaries["published"] == []


def test_settings_retire_payment_and_init_point_fields() -> None:
    fields = _settings_field_names(_tree(CONFIG_PATH))

    assert not {name for name in fields if name.startswith("MP_")}
    assert not {name for name in fields if name.startswith("IOT_INIT_POINT_")}
    assert {"DEFAULT_MARKETPLACE_FEE", "SECURITY_KEY"}.isdisjoint(fields)
    assert {
        "JWT_SECRET_KEY",
        "JWT_ALGORITHM",
        "BOOTSTRAP_ADMIN_EMAIL",
        "MAIL_TRANSPORT",
        "MQTT_CLIENT_ID",
        "EMQX_HOST",
        "GOOGLE_OAUTH_ENABLED",
    } <= fields


def test_requirements_retire_mercadopago_sdk_pin() -> None:
    requirement_names = {
        line.split("==", 1)[0].strip().lower()
        for line in REQUIREMENTS_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    assert "mercadopago" not in requirement_names


def test_executable_payment_files_are_removed_and_runtime_remains() -> None:
    unexpected = [path for path in RETIRED_EXECUTABLE_PATHS if (BACKEND_ROOT / path).exists()]
    assert unexpected == []
    assert RUNTIME_PATH.is_file()
    assert not (BACKEND_ROOT / "app/api/mercadopago").exists()
