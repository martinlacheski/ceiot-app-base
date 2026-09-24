import uuid

from fastapi.testclient import TestClient  # type: ignore[import-not-found]

from app.api.device.models import Device, DeviceStatus
from app.api.environment.environment.models import Environment
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.api.public import router as public_router


TEST_ENVIRONMENT_TYPE_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class EmailServiceSpy:
    sent = []
    error: Exception | None = None

    async def send_contact_email(
        self,
        *,
        name: str,
        email_from: str,
        company: str | None,
        phone: str | None,
        message_text: str,
    ):
        if self.error is not None:
            raise self.error

        self.sent.append(
            {
                "name": name,
                "email_from": email_from,
                "company": company,
                "phone": phone,
                "message_text": message_text,
            }
        )


class FixedWindowClock:
    def __init__(self):
        self.now = 0.0

    def advance(self, seconds: float) -> None:
        self.now += seconds

    def __call__(self) -> float:
        return self.now


def install_contact_rate_limiter(monkeypatch, *, limit: int = 5, window_seconds: int = 600):
    clock = FixedWindowClock()
    limiter = public_router.PublicContactRateLimiter(
        limit=limit,
        window_seconds=window_seconds,
        now=clock,
    )
    monkeypatch.setattr(public_router, "contact_rate_limiter", limiter)
    return clock


def test_public_contact_endpoint_sends_email(client: TestClient, monkeypatch):
    EmailServiceSpy.sent = []
    EmailServiceSpy.error = None
    monkeypatch.setattr("app.api.public.router.EmailService", EmailServiceSpy)
    install_contact_rate_limiter(monkeypatch)

    response = client.post(
        "/api/public/contact",
        json={
            "name": "Martin",
            "email": "martin@example.com",
            "company": "Example Corp",
            "phone": "+54 11 5555 5555",
            "message": "Quiero conocer disponibilidad para una prueba piloto.",
        },
    )

    assert response.status_code == 202
    assert response.json() == {"message": "Consulta enviada correctamente."}
    assert EmailServiceSpy.sent == [
        {
            "name": "Martin",
            "email_from": "martin@example.com",
            "company": "Example Corp",
            "phone": "+54 11 5555 5555",
            "message_text": "Quiero conocer disponibilidad para una prueba piloto.",
        }
    ]


def test_public_contact_endpoint_validates_payload(client: TestClient):
    response = client.post(
        "/api/public/contact",
        json={
            "name": "A",
            "email": "not-an-email",
            "message": "corto",
        },
    )

    assert response.status_code == 422


def test_public_contact_endpoint_rejects_short_name(client: TestClient):
    response = client.post(
        "/api/public/contact",
        json={
            "name": "Ana",
            "email": "ana@example.com",
            "message": "Quiero conocer disponibilidad para una prueba piloto.",
        },
    )

    assert response.status_code == 422


def test_public_contact_endpoint_applies_required_lengths_after_trimming(
    client: TestClient, monkeypatch
):
    EmailServiceSpy.sent = []
    EmailServiceSpy.error = None
    monkeypatch.setattr("app.api.public.router.EmailService", EmailServiceSpy)
    install_contact_rate_limiter(monkeypatch)

    padded_short_name = client.post(
        "/api/public/contact",
        json={
            "name": "  Ana  ",
            "email": "ana@example.com",
            "message": "Mensaje suficientemente largo.",
        },
    )
    padded_short_message = client.post(
        "/api/public/contact",
        json={
            "name": "Analia",
            "email": "ana@example.com",
            "message": "   corto   ",
        },
    )

    assert padded_short_name.status_code == 422
    assert padded_short_message.status_code == 422
    assert EmailServiceSpy.sent == []


def test_public_contact_endpoint_rejects_whitespace_only_required_fields(client: TestClient, monkeypatch):
    EmailServiceSpy.sent = []
    EmailServiceSpy.error = None
    monkeypatch.setattr("app.api.public.router.EmailService", EmailServiceSpy)
    install_contact_rate_limiter(monkeypatch)

    response = client.post(
        "/api/public/contact",
        json={
            "name": "  ",
            "email": "martin@example.com",
            "message": "          ",
        },
    )

    assert response.status_code == 422
    assert EmailServiceSpy.sent == []


def test_public_contact_endpoint_accepts_honeypot_without_sending_email(client: TestClient, monkeypatch):
    EmailServiceSpy.sent = []
    EmailServiceSpy.error = None
    monkeypatch.setattr("app.api.public.router.EmailService", EmailServiceSpy)
    install_contact_rate_limiter(monkeypatch)

    response = client.post(
        "/api/public/contact",
        json={
            "name": "Martin",
            "email": "martin@example.com",
            "company": "Example Corp",
            "phone": "+54 11 5555 5555",
            "message": "Quiero conocer disponibilidad para una prueba piloto.",
            "website": "https://spam.example.com",
        },
    )

    assert response.status_code == 202
    assert response.json() == {"message": "Consulta enviada correctamente."}
    assert EmailServiceSpy.sent == []


def test_public_contact_endpoint_rate_limits_by_client_ip(client: TestClient, monkeypatch):
    EmailServiceSpy.sent = []
    EmailServiceSpy.error = None
    monkeypatch.setattr("app.api.public.router.EmailService", EmailServiceSpy)
    clock = install_contact_rate_limiter(monkeypatch)

    payload = {
        "name": "Martin",
        "email": "martin@example.com",
        "company": "Example Corp",
        "phone": "+54 11 5555 5555",
        "message": "Quiero conocer disponibilidad para una prueba piloto.",
    }

    for _ in range(5):
        response = client.post("/api/public/contact", json=payload)
        assert response.status_code == 202
        clock.advance(1)

    limited_response = client.post("/api/public/contact", json=payload)

    assert limited_response.status_code == 429
    assert limited_response.json() == {"detail": "Too many contact requests. Please try again later."}
    assert len(EmailServiceSpy.sent) == 5


def test_public_contact_endpoint_returns_generic_provider_failure(client: TestClient, monkeypatch):
    EmailServiceSpy.sent = []
    EmailServiceSpy.error = RuntimeError("smtp provider timeout")
    monkeypatch.setattr("app.api.public.router.EmailService", EmailServiceSpy)
    install_contact_rate_limiter(monkeypatch)

    response = client.post(
        "/api/public/contact",
        json={
            "name": "Martin",
            "email": "martin@example.com",
            "company": "Example Corp",
            "phone": "+54 11 5555 5555",
            "message": "Quiero conocer disponibilidad para una prueba piloto.",
        },
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "Contact service is temporarily unavailable. Please try again later."
    }
    assert "smtp provider timeout" not in response.text
    assert EmailServiceSpy.sent == []


def test_public_map_locations_returns_sanitized_establishment_projection(client: TestClient, session):
    country = LocationCountry(name="Argentina")
    state = LocationState(name="Santa Fe", country=country)
    city = LocationCity(name="Rafaela", postal_code="2300", state=state)
    environment = Environment(
        name="Matemetal",
        address="Av. Example 123",
        location="-31.2503,-61.4867",
        description="Demo location",
        city=city,
        type_id=TEST_ENVIRONMENT_TYPE_ID,
        is_active=True,
        is_public_map_visible=False,
    )
    active_device_one = Device(
        serial="SERIAL-001",
        name="Device 1",
        environment=environment,
        status=DeviceStatus.PAIRED,
        is_active=True,
        enabled=True,
        broker_connected=False,
    )
    active_device_two = Device(
        serial="SERIAL-002",
        name="Device 2",
        environment=environment,
        status=DeviceStatus.ACTIVE,
        is_active=True,
        enabled=True,
        broker_connected=False,
    )
    maintenance_device = Device(
        serial="SERIAL-003",
        name="Device 3",
        environment=environment,
        status=DeviceStatus.MAINTENANCE,
        is_active=True,
        enabled=True,
        broker_connected=True,
    )

    session.add(country)
    session.add(state)
    session.add(city)
    session.add(environment)
    session.add(active_device_one)
    session.add(active_device_two)
    session.add(maintenance_device)
    session.commit()

    response = client.get("/api/public/map/locations")

    assert response.status_code == 200
    assert response.json() == [
        {
            "displayName": "Matemetal",
            "city": "Rafaela",
            "state": "Santa Fe",
            "country": "Argentina",
            "latitude": -31.2503,
            "longitude": -61.4867,
            "activeDeviceCount": 3,
        }
    ]
    assert set(response.json()[0]) == {
        "displayName",
        "latitude",
        "longitude",
        "city",
        "state",
        "country",
        "activeDeviceCount",
    }
    assert {"id", "serial", "ownerId", "status", "lat", "lng", "name"}.isdisjoint(
        response.json()[0].keys()
    )


def test_public_map_locations_filters_non_public_ready_records(client: TestClient, session):
    country = LocationCountry(name="Argentina")
    state = LocationState(name="Cordoba", country=country)
    city = LocationCity(name="Cordoba", postal_code="5000", state=state)

    visible_environment = Environment(
        name="Visible Store",
        address="Street 1",
        location="-31.4167,-64.1833",
        description="Visible environment",
        city=city,
        type_id=TEST_ENVIRONMENT_TYPE_ID,
        is_active=True,
        is_public_map_visible=True,
    )
    hidden_environment = Environment(
        name="Hidden Store",
        address="Street hidden",
        location="-31.4100,-64.1800",
        description="Hidden environment",
        city=city,
        type_id=TEST_ENVIRONMENT_TYPE_ID,
        is_active=True,
        is_public_map_visible=False,
    )
    inactive_environment = Environment(
        name="Inactive Store",
        address="Street 2",
        location="-31.4201,-64.1888",
        description="Inactive environment",
        city=city,
        type_id=TEST_ENVIRONMENT_TYPE_ID,
        is_active=False,
        is_public_map_visible=True,
    )
    invalid_location_environment = Environment(
        name="Bad Location Store",
        address="Street 3",
        location="No coordinates available",
        description="Invalid location",
        city=city,
        type_id=TEST_ENVIRONMENT_TYPE_ID,
        is_active=True,
        is_public_map_visible=True,
    )

    session.add(country)
    session.add(state)
    session.add(city)
    session.add(visible_environment)
    session.add(hidden_environment)
    session.add(inactive_environment)
    session.add(invalid_location_environment)
    session.add(
        Device(
            serial="VISIBLE-ACTIVE",
            name="Visible active",
            environment=visible_environment,
            status=DeviceStatus.ACTIVE,
            is_active=True,
            enabled=True,
            broker_connected=False,
        )
    )
    session.add(
        Device(
            serial="VISIBLE-MAINT",
            name="Visible maintenance",
            environment=visible_environment,
            status=DeviceStatus.MAINTENANCE,
            is_active=True,
            enabled=True,
            broker_connected=True,
        )
    )
    session.add(
        Device(
            serial="VISIBLE-DISABLED",
            name="Visible disabled",
            environment=visible_environment,
            status=DeviceStatus.ACTIVE,
            is_active=True,
            enabled=False,
        )
    )
    session.add(
        Device(
            serial="VISIBLE-INACTIVE",
            name="Visible inactive",
            environment=visible_environment,
            status=DeviceStatus.ACTIVE,
            is_active=False,
            enabled=True,
        )
    )
    session.add(
        Device(
            serial="VISIBLE-NEW",
            name="Visible new",
            environment=visible_environment,
            status=DeviceStatus.NEW,
            is_active=True,
            enabled=True,
        )
    )
    session.add(
        Device(
            serial="VISIBLE-UNPAIRED",
            name="Visible unpaired",
            environment=visible_environment,
            status=DeviceStatus.UNPAIRED,
            is_active=True,
            enabled=True,
        )
    )
    session.add(
        Device(
            serial="HIDDEN-ACTIVE",
            name="Hidden active",
            environment=hidden_environment,
            status=DeviceStatus.ACTIVE,
            is_active=True,
            enabled=True,
        )
    )
    session.add(
        Device(
            serial="INACTIVE-ENV",
            name="Inactive environment device",
            environment=inactive_environment,
            status=DeviceStatus.ACTIVE,
            is_active=True,
            enabled=True,
        )
    )
    session.add(
        Device(
            serial="BAD-LOCATION",
            name="Bad location device",
            environment=invalid_location_environment,
            status=DeviceStatus.ACTIVE,
            is_active=True,
            enabled=True,
        )
    )
    session.commit()

    response = client.get("/api/public/map/locations")

    assert response.status_code == 200
    assert response.json() == [
        {
            "displayName": "Hidden Store",
            "city": "Cordoba",
            "state": "Cordoba",
            "country": "Argentina",
            "latitude": -31.41,
            "longitude": -64.18,
            "activeDeviceCount": 1,
        },
        {
            "displayName": "Visible Store",
            "city": "Cordoba",
            "state": "Cordoba",
            "country": "Argentina",
            "latitude": -31.4167,
            "longitude": -64.1833,
            "activeDeviceCount": 2,
        }
    ]


def test_legacy_public_map_devices_endpoint_is_removed(client: TestClient):
    response = client.get("/api/public/map/devices")

    assert response.status_code == 404
    paths = client.get("/api/openapi.json").json()["paths"]
    assert "/api/public/map/devices" not in paths
    assert "/api/public/map/locations" in paths


def test_public_map_locations_sets_short_public_cache_header(client: TestClient):
    response = client.get("/api/public/map/locations")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=60"


def test_public_time_endpoint_returns_epoch_ms_and_iso(client: TestClient):
    import time as time_module

    before_ms = int(time_module.time() * 1000)
    response = client.get("/api/public/time")
    after_ms = int(time_module.time() * 1000)

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"epoch_ms", "iso"}
    assert isinstance(body["epoch_ms"], int)
    assert before_ms - 2000 <= body["epoch_ms"] <= after_ms + 2000
    assert body["iso"].endswith("Z")
    assert "T" in body["iso"]


def test_public_time_endpoint_sets_no_store_cache_header(client: TestClient):
    response = client.get("/api/public/time")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"


def test_public_time_endpoint_is_not_authenticated(client: TestClient):
    response = client.get("/api/public/time")

    assert response.status_code == 200


def test_public_time_endpoint_rate_limits_by_client_ip(client: TestClient, monkeypatch):
    clock = FixedWindowClock()
    limiter = public_router.PublicContactRateLimiter(limit=60, window_seconds=60, now=clock)
    monkeypatch.setattr(public_router, "public_time_rate_limiter", limiter)

    for _ in range(60):
        response = client.get("/api/public/time")
        assert response.status_code == 200
        clock.advance(0.1)

    limited_response = client.get("/api/public/time")

    assert limited_response.status_code == 429
