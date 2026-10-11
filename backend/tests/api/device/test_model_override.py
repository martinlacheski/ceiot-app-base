"""``device.model`` is an optional per-unit override of the type's ``hardware_model``.

NULL means "use the device type's hardware model". Reads, the list filter, the global
search and the model sort all use the effective value ``COALESCE(device.model,
device_type.hardware_model)``; writes never copy the type default into the device.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.device.device_type.models import DeviceTypeCatalog
from app.api.device.models import Device, DeviceCreate
from app.api.device.permissions import DevicePermissions
from app.api.device.repository import DeviceRepository
from app.api.device.service import DeviceService
from app.core.security import create_access_token

TYPE_MODEL = "ESP32-DevKit"


@pytest.fixture
def board_type(session: Session) -> DeviceTypeCatalog:
    device_type = DeviceTypeCatalog(code="board_test", name="Placa test", hardware_model=TYPE_MODEL)
    session.add(device_type)
    session.commit()
    session.refresh(device_type)
    return device_type


def _headers(user) -> dict[str, str]:
    token, _ = create_access_token({"id": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("requested", "stored", "effective"),
    [
        (None, None, TYPE_MODEL),
        ("", None, TYPE_MODEL),
        ("  esp32-devkit ", None, TYPE_MODEL),
        ("ESP32-S3", "ESP32-S3", "ESP32-S3"),
        ("  ESP32-C3  ", "ESP32-C3", "ESP32-C3"),
    ],
)
async def test_create_stores_only_a_real_override(
    session, async_session, board_type, requested, stored, effective
):
    repository = DeviceRepository(async_session)
    device = await repository.create_with_data(
        DeviceCreate(
            serial=f"IOT-0000-{uuid.uuid4().int % 10000:04d}",
            name="Placa",
            deviceTypeId=board_type.id,
            model=requested,
        )
    )

    assert device.model == stored
    assert device.effective_model == effective


def test_reads_list_filter_search_and_sort_use_the_effective_model(
    client: TestClient, session: Session, admin_user, board_type
):
    marker = f"Modelo efectivo {uuid.uuid4()}"
    inherited = Device(serial="IOT-MODEL-0001", name=marker, device_type_id=board_type.id, model=None)
    overridden = Device(serial="IOT-MODEL-0002", name=marker, device_type_id=board_type.id, model="AAA-Custom")
    untyped_type = DeviceTypeCatalog(code="no_model", name="Sin modelo", hardware_model=None)
    session.add(untyped_type)
    session.flush()
    bare = Device(serial="IOT-MODEL-0003", name=marker, device_type_id=untyped_type.id, model=None)
    session.add_all([inherited, overridden, bare])
    admin_user.permissions = ["device:read_all"]
    session.add(admin_user)
    session.commit()
    headers = _headers(admin_user)

    detail = client.get(f"/api/devices/{inherited.id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["model"] == TYPE_MODEL

    listed = client.get("/api/devices", params={"search": marker, "sort_by": "model"}, headers=headers)
    assert listed.status_code == 200, listed.text
    assert [item["model"] for item in listed.json()["items"]] == ["AAA-Custom", TYPE_MODEL, None]

    descending = client.get(
        "/api/devices",
        params={"search": marker, "sort_by": "model", "sort_order": "desc"},
        headers=headers,
    )
    assert [item["model"] for item in descending.json()["items"]] == [TYPE_MODEL, "AAA-Custom", None]

    filtered = client.get("/api/devices", params={"model": "devkit"}, headers=headers)
    assert filtered.status_code == 200, filtered.text
    assert [item["serial"] for item in filtered.json()["items"]] == ["IOT-MODEL-0001"]

    searched = client.get("/api/devices", params={"search": "esp32-dev"}, headers=headers)
    assert searched.status_code == 200, searched.text
    assert [item["serial"] for item in searched.json()["items"]] == ["IOT-MODEL-0001"]


def test_create_endpoint_returns_the_effective_model_without_copying_it(
    client: TestClient, session: Session, admin_user, board_type
):
    admin_user.permissions = [DevicePermissions.CREATE]
    session.add(admin_user)
    session.commit()
    response = client.post(
        "/api/devices",
        json={"serial": DeviceService.generate_serial(), "name": "Placa", "deviceTypeId": str(board_type.id)},
        headers=_headers(admin_user),
    )

    assert response.status_code == 200, response.text
    assert response.json()["model"] == TYPE_MODEL
    session.expire_all()
    stored = session.get(Device, uuid.UUID(response.json()["id"]))
    assert stored.model is None


@pytest.mark.asyncio
async def test_provisioning_model_is_an_override_only_when_it_differs(session, async_session):
    from app.api.device.device_type.constants import DEFAULT_DEVICE_TYPE_ID
    from app.api.provisioning.models import ProvisioningDevicePrepareRequest, ProvisioningDevicePrepareResponse
    from app.api.provisioning.service import ProvisioningService

    session.add(DeviceTypeCatalog(
        id=DEFAULT_DEVICE_TYPE_ID, code="environmental", name="Ambiental", hardware_model="Guition-1"
    ))
    session.commit()
    serials = iter(["IOT-0000-0081", "IOT-0000-0082", "IOT-0000-0083"])
    provisioning = ProvisioningService(DeviceRepository(async_session), serial_generator=lambda: next(serials))

    same = await provisioning.prepare_device(ProvisioningDevicePrepareRequest(model="guition-1 "))
    other = await provisioning.prepare_device(ProvisioningDevicePrepareRequest(model="Guition-2"))
    default = await provisioning.prepare_device(ProvisioningDevicePrepareRequest())

    assert (same.model, other.model, default.model) == (None, "Guition-2", None)
    assert [ProvisioningDevicePrepareResponse.model_validate(d).model for d in (same, other, default)] == [
        "Guition-1", "Guition-2", "Guition-1",
    ]
