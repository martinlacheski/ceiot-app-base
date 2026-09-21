import pytest
import uuid
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.device.device_type.constants import (
    DEFAULT_DEVICE_TYPE_ID,
    DEFAULT_DEVICE_TYPE_NAME,
    LEGACY_OTHER_DEVICE_TYPE_ID,
    LEGACY_OTHER_DEVICE_TYPE_NAME,
)
from app.api.device.device_type.models import DeviceTypeCatalog
from app.api.device.service import DeviceService
from app.api.device.models import Device, DeviceStatus
from app.api.device.repository import DeviceRepository
from app.api.auth.models import User
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.core.security import hash_password, create_access_token
from app.api.device.permissions import DevicePermissions

# --- Unit Tests for Service ---


def test_serial_generation_and_validation():
    # 1. Generate
    serial = DeviceService.generate_serial()
    assert serial.startswith("IOT-")
    assert len(serial) == 13
    assert DeviceService.validate_serial(serial)

    # 2. Invalid
    assert not DeviceService.validate_serial("INVALID")
    assert not DeviceService.validate_serial("IOT-1234-567")  # Short

    # 3. Normalize
    assert DeviceService.normalize_serial("iot7m9k2fq8") == "IOT-7M9K-2FQ8"

# --- Fixtures ---


@pytest.fixture(name="admin_token")
def admin_token_fixture(client: TestClient, session: Session):
    # Create an admin user with Device permissions
    user = session.exec(select(User).where(
        User.username == "deviceadmin")).first()
    if not user:
        user = User(
            email="admin@device.com",
            username="deviceadmin",
            password=hash_password("adminpass"),
            is_verified=True,
            first_name="Device",
            last_name="Admin",
            identification_number="DEVADMIN",
            permissions=[
                DevicePermissions.READ,
                DevicePermissions.CREATE,
                DevicePermissions.UPDATE,
                DevicePermissions.DELETE,
                DevicePermissions.PAIR,
                DevicePermissions.READ_ALL
            ]
        )
        session.add(user)
        session.commit()
        session.refresh(user)

    # Login
    response = client.post(
        "/api/auth/login",
        data={"username": "deviceadmin", "password": "adminpass"}
    )
    return response.json()["access_token"]

# --- Integration Tests ---


def _create_pairing_environment(session: Session, owner: User) -> Environment:
    country = LocationCountry(name=f"AR Pair API {uuid.uuid4()}")
    session.add(country)
    session.commit()
    session.refresh(country)

    state = LocationState(name=f"Misiones Pair API {uuid.uuid4()}", country_id=country.id)
    session.add(state)
    session.commit()
    session.refresh(state)

    city = LocationCity(
        name=f"Posadas Pair API {uuid.uuid4()}",
        postal_code="3300",
        state_id=state.id,
    )
    session.add(city)
    session.commit()
    session.refresh(city)

    env_type = EnvironmentType(name=f"Pair API Type {uuid.uuid4()}")
    session.add(env_type)
    session.commit()
    session.refresh(env_type)

    environment = Environment(
        name="Pair API Env",
        address="Street 123",
        location="Lobby",
        description="Pair API regression test env",
        city_id=city.id,
        type_id=env_type.id,
    )
    session.add(environment)
    session.commit()
    session.refresh(environment)

    session.add(
        EnvironmentUser(
            environment_id=environment.id,
            user_id=owner.id,
            is_owner=True,
            is_active=True,
        )
    )
    session.commit()

    return environment


def test_create_device_admin(client: TestClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    serial = DeviceService.generate_serial()

    data = {
        "serial": serial,
        "name": "Test Device",
        "deviceTypeId": str(DEFAULT_DEVICE_TYPE_ID),
        "model": "V1",
    }

    # Create
    response = client.post("/api/devices", json=data, headers=headers)
    assert response.status_code == 200
    content = response.json()
    assert content["serial"] == serial
    assert "dispenserData" not in content
    assert content["macAddress"] is None
    assert content["gpsLatitude"] is None
    assert content["gpsLongitude"] is None
    assert content["gpsUpdatedAt"] is None
    assert content["deviceTypeId"] == str(DEFAULT_DEVICE_TYPE_ID)
    assert content["type"]["name"] == DEFAULT_DEVICE_TYPE_NAME
    assert "deviceType" not in content

    device_id = content["id"]

    # Read
    response = client.get("/api/devices", headers=headers)
    assert response.status_code == 200
    # Check if our device is in list
    ids = [d["id"] for d in response.json()["items"]]
    assert device_id in ids


def test_create_device_with_catalog_other_returns_catalog_type(
    client: TestClient,
    admin_token: str,
):
    headers = {"Authorization": f"Bearer {admin_token}"}
    serial = DeviceService.generate_serial()

    response = client.post(
        "/api/devices",
        json={
            "serial": serial,
            "name": "Legacy Other Device",
            "deviceTypeId": str(LEGACY_OTHER_DEVICE_TYPE_ID),
            "model": "Legacy-V1",
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["deviceTypeId"] == str(LEGACY_OTHER_DEVICE_TYPE_ID)
    assert payload["type"]["id"] == str(LEGACY_OTHER_DEVICE_TYPE_ID)
    assert payload["type"]["name"] == LEGACY_OTHER_DEVICE_TYPE_NAME
    assert "dispenserData" not in payload
    assert "deviceType" not in payload


def test_create_device_rejects_inactive_device_type_id(
    client: TestClient,
    admin_token: str,
    session: Session,
):
    headers = {"Authorization": f"Bearer {admin_token}"}
    inactive_type = DeviceTypeCatalog(name="Inactive Type", is_active=False)
    session.add(inactive_type)
    session.commit()
    session.refresh(inactive_type)

    response = client.post(
        "/api/devices",
        json={
            "serial": DeviceService.generate_serial(),
            "name": "Inactive Type Device",
            "deviceTypeId": str(inactive_type.id),
        },
        headers=headers,
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid device type reference"}


def test_pairing_flow(client: TestClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create Device
    serial = DeviceService.generate_serial()
    create_data = {
        "serial": serial,
        "name": "Pairing Test Device",
        "deviceTypeId": str(DEFAULT_DEVICE_TYPE_ID),
        "model": "V1"
    }
    r = client.post("/api/devices", json=create_data, headers=headers)
    assert r.status_code == 200
    device_id = r.json()["id"]

    # 2. Pair
    # Since we don't handle Environment setup easily in tests without seeds,
    # we know the endpoint logic:
    # It checks for valid Serial.
    # It checks for valid Environment ID (FK).
    # If we pass random UUID for Env, it will likely fail DB constraint if not mocked,
    # OR if we just want to test "Device Not Found" or "Already Paired" logic.

    # Without admin flag or environment ownership, the endpoint rejects before looking up the device.
    fake_pair_req = {
        "serial": "IOT-0000-0000",
        "environmentId": str(uuid.uuid4()),
        "description": "Pairing Test Service",
    }
    r = client.post("/api/devices/pair", json=fake_pair_req, headers=headers)
    assert r.status_code == 403

    # To test Success, we'd need a real environment.
    # We can create one if we have permissions and knowing the requirements (City, Type).
    # Too complex for this unit. We accept 404 is technically executing the router logic.










def test_uniqueness_check(client: TestClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}
    serial = DeviceService.generate_serial()
    data = {
        "serial": serial,
        "name": "Unique Test",
        "deviceTypeId": str(DEFAULT_DEVICE_TYPE_ID)
    }

    # First
    r1 = client.post("/api/devices", json=data, headers=headers)
    assert r1.status_code == 200

    # Second
    r2 = client.post("/api/devices", json=data, headers=headers)
    assert r2.status_code == 409


def test_list_devices_filters_by_device_type_id(client: TestClient, admin_token: str):
    headers = {"Authorization": f"Bearer {admin_token}"}

    default_response = client.post(
        "/api/devices",
        json={
            "serial": DeviceService.generate_serial(),
            "name": "Default Type Device",
            "deviceTypeId": str(DEFAULT_DEVICE_TYPE_ID),
        },
        headers=headers,
    )
    other_response = client.post(
        "/api/devices",
        json={
            "serial": DeviceService.generate_serial(),
            "name": "Other Type Device",
            "deviceTypeId": str(LEGACY_OTHER_DEVICE_TYPE_ID),
        },
        headers=headers,
    )

    assert default_response.status_code == 200
    assert other_response.status_code == 200

    response = client.get(
        f"/api/devices?device_type_id={LEGACY_OTHER_DEVICE_TYPE_ID}",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 1
    returned_ids = {item["id"] for item in payload["items"]}
    assert other_response.json()["id"] in returned_ids
    assert default_response.json()["id"] not in returned_ids


def test_list_devices_sort_is_stable_across_pages(
    client: TestClient,
    admin_token: str,
    session: Session,
):
    name = f"Stable sort {uuid.uuid4()}"
    ids = [
        uuid.UUID("10000000-0000-0000-0000-000000000003"),
        uuid.UUID("10000000-0000-0000-0000-000000000001"),
        uuid.UUID("10000000-0000-0000-0000-000000000002"),
    ]
    for index, device_id in enumerate(ids):
        session.add(
            Device(
                id=device_id,
                serial=f"IOT-STAB-000{index}",
                name=name,
                is_active=True,
            )
        )
    session.commit()

    headers = {"Authorization": f"Bearer {admin_token}"}
    first_page = client.get(
        "/api/devices",
        params={"search": name, "sort_by": "name", "sort_order": "asc", "page": 1, "per_page": 2},
        headers=headers,
    )
    second_page = client.get(
        "/api/devices",
        params={"search": name, "sort_by": "name", "sort_order": "asc", "page": 2, "per_page": 2},
        headers=headers,
    )

    assert first_page.status_code == 200
    assert second_page.status_code == 200
    returned_ids = [item["id"] for item in first_page.json()["items"] + second_page.json()["items"]]
    assert returned_ids == [str(device_id) for device_id in sorted(ids)]


def test_list_devices_nullable_sort_keeps_nulls_last(
    client: TestClient,
    admin_token: str,
    session: Session,
):
    marker = f"Nullable sort {uuid.uuid4()}"
    session.add_all(
        [
            Device(serial="IOT-NULL-0001", name=marker, model=None, is_active=True),
            Device(serial="IOT-NULL-0002", name=marker, model="A", is_active=True),
        ]
    )
    session.commit()

    response = client.get(
        "/api/devices",
        params={"search": marker, "sort_by": "model", "sort_order": "desc"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    assert [item["model"] for item in response.json()["items"]] == ["A", None]






def test_list_devices_with_paired_environment_returns_generic_location(
    client: TestClient,
    admin_token: str,
    session: Session,
):
    country = LocationCountry(name="AR Device List")
    session.add(country)
    session.commit()
    session.refresh(country)

    state = LocationState(name="Misiones Device List", country_id=country.id)
    session.add(state)
    session.commit()
    session.refresh(state)

    city = LocationCity(name="Posadas Device List", postal_code="3300", state_id=state.id)
    session.add(city)
    session.commit()
    session.refresh(city)

    env_type = EnvironmentType(name="Device List Type")
    session.add(env_type)
    session.commit()
    session.refresh(env_type)

    admin = session.exec(select(User).where(User.username == "deviceadmin")).first()
    environment = Environment(
        name="Paired Device Env",
        address="Street 123",
        location="Lobby",
        description="Regression test env",
        city_id=city.id,
        type_id=env_type.id,
    )
    session.add(environment)
    session.commit()
    session.refresh(environment)

    session.add(
        EnvironmentUser(
            environment_id=environment.id,
            user_id=admin.id,
            is_owner=True,
            is_active=True,
        )
    )

    device = Device(
        serial=DeviceService.generate_serial(),
        name="Paired Device",
        status=DeviceStatus.PAIRED,
        environment_id=environment.id,
        is_active=True,
    )
    session.add(device)
    session.commit()
    session.refresh(device)

    response = client.get(
        "/api/devices?page=1&per_page=10&is_active=true",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    matched = next(item for item in payload["items"] if item["id"] == str(device.id))
    assert matched["environment"]["id"] == str(environment.id)
    assert matched["effectiveLocation"] == "Lobby"
    assert matched["effectiveLocationSource"] == "environment"


def test_device_detail_returns_nullable_mac_and_gps_fields(
    client: TestClient,
    admin_token: str,
    session: Session,
):
    device = Device(
        serial=DeviceService.generate_serial(),
        name="Device GPS",
        status=DeviceStatus.NEW,
        is_active=True,
        mac_address="AA:BB:CC:DD:EE:FF",
        gps_latitude=-27.362137,
        gps_longitude=-55.900874,
    )
    session.add(device)
    session.commit()
    session.refresh(device)

    response = client.get(
        f"/api/devices/{device.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["macAddress"] == "AA:BB:CC:DD:EE:FF"
    assert payload["gpsLatitude"] == pytest.approx(-27.362137)
    assert payload["gpsLongitude"] == pytest.approx(-55.900874)
    assert payload["gpsUpdatedAt"] is None
    assert payload["effectiveLocation"] == "-27.362137,-55.900874"
    assert payload["effectiveLocationSource"] == "device_gps"
