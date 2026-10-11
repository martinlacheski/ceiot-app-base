"""Model side of the low-risk normalization (migrations 0020 and 0021).

0020 drops the redundant ``sensorreading.device_type`` text (the type is
``device.device_type_id``). 0021 adds ``created_at timestamptz NOT NULL DEFAULT now()``
to the device, environment, location and type catalog tables; the models mirror it
with a timezone-aware column, a server default and an aware Python default.
"""

from datetime import timedelta

import pytest
from sqlalchemy import DateTime

from app.api.device.models import Device, DeviceRead
from app.api.environment.environment.models import Environment
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.api.sensor.models import SensorReading
from app.api.tax.identification_type.models import IdentificationType

CATALOG_MODELS = (
    Device,
    Environment,
    EnvironmentType,
    LocationCountry,
    LocationState,
    LocationCity,
    IdentificationType,
)


def test_sensorreading_has_no_device_type_column() -> None:
    assert "device_type" not in SensorReading.__table__.c
    assert "device_type" not in SensorReading.model_fields


@pytest.mark.parametrize("model", CATALOG_MODELS, ids=lambda model: model.__tablename__)
def test_catalog_created_at_is_a_timezone_aware_not_null_column_with_server_default(model) -> None:
    column = model.__table__.c["created_at"]
    assert isinstance(column.type, DateTime)
    assert column.type.timezone is True
    assert column.nullable is False
    assert column.server_default is not None


@pytest.mark.parametrize("model", CATALOG_MODELS, ids=lambda model: model.__tablename__)
def test_catalog_created_at_python_default_is_aware_utc(model) -> None:
    value = model.model_fields["created_at"].default_factory()
    assert value.tzinfo is not None
    assert value.utcoffset() == timedelta(0)


def test_device_read_exposes_created_at_like_updated_at() -> None:
    assert "created_at" in DeviceRead.model_fields
    assert "updated_at" in DeviceRead.model_fields
