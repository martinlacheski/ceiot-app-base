from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[2]

LEGACY_MODEL_PATHS = (
    "app/api/device/billing_settings",
    "app/api/mercadopago",
    "app/api/settings",
    "app/api/tax/tax_type",
    "app/api/webhook",
)

LEGACY_MODEL_TOKENS = (
    "merchant_order_id",
    "commission_rate",
    "dvem_commission_rate",
    "guest_commission_rate",
    "mp_country_id",
    "mp_state_id",
    "mp_city_id",
    "mp_store_status",
    "DispenserData",
    "temp_water",
    "water_state",
    "relay_water",
    "relay_heater",
    "QR_REQUESTED",
    "QR_GENERATED",
    "QR_EXPIRED",
    "DISPENSE",
    "WEBHOOK_MP",
    "GENERATED_QR",
)


def test_iot_schema_has_baseline_and_environmental_revision() -> None:
    revisions = sorted((BACKEND_ROOT / "alembic/versions").glob("*.py"))
    assert [revision.name for revision in revisions] == [
        "0001_iot_baseline.py",
        "0002_add_environmental_readings.py",
        "0003_add_device_history_environment_snapshot.py",
    ]


def test_legacy_model_families_are_absent() -> None:
    for relative_path in LEGACY_MODEL_PATHS:
        assert not (BACKEND_ROOT / relative_path).exists(), relative_path


def test_active_models_do_not_expose_legacy_contracts() -> None:
    model_paths = sorted((BACKEND_ROOT / "app/api").glob("**/models.py"))
    source = "\n".join(path.read_text() for path in model_paths)
    for token in LEGACY_MODEL_TOKENS:
        assert token not in source, token


def test_runtime_does_not_bootstrap_tables_with_create_all() -> None:
    runtime_source = "\n".join(
        (BACKEND_ROOT / relative_path).read_text()
        for relative_path in ("app/main.py", "app/core/db.py")
    )
    assert "create_all" not in runtime_source
