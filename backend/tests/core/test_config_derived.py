"""Settings derived from the shared network values (root .env, passed by compose).

CORS origins, trusted hosts and the OTA download base are built from the
frontend/landing/backend addresses, so a port or host is written only once;
the list variables only add extras.
"""

import pytest

from app.core.config import Settings


def make_settings(**overrides) -> Settings:
    values = {
        "BACKEND_HOST_URL": "http://localhost",
        "BACKEND_PORT": "8000",
        "BACKEND_PUBLIC_BASE_URL": None,
        "FIRMWARE_DOWNLOAD_BASE_URL": None,
        "BACKEND_CORS_ORIGINS": [],
        "BACKEND_TRUSTED_HOSTS": [],
        "LANDING_URL": None,
        "LAN_BIND_IP": None,
        "VITE_FRONTEND_URL": "http://localhost",
        "VITE_FRONTEND_PORT": 5173,
        "DATABASE_URL": "postgresql+psycopg://u:p@postgresql:5432/db",
        "ALEMBIC_DATABASE_URL": "postgresql+psycopg://a:p@postgresql:5432/db",
        "JWT_SECRET_KEY": "synthetic-secret",
        "JWT_ALGORITHM": "HS256",
        "JWT_EXPIRES_MINUTES": 30,
        "PROJECT_NAME": "Test",
        "ENVIRONMENT": "DEV",
        "MAX_UPLOAD_MB": 3,
        "MQTT_CLIENT_ID": "test",
        "MQTT_TOPIC_DEVICE_SUB": "iot/devices/#",
        "EMQX_HOST": "emqx",
        "EMQX_PORT": 1883,
        "EMQX_USER": "backend-services",
        "EMQX_PASSWORD": "synthetic",
        "EMQX_API_KEY": None,
        "EMQX_API_SECRET": None,
        "MAIL_TRANSPORT": "mailpit",
        "MAIL_FROM": "no-reply@example.com",
        "MAIL_PORT": 587,
        "MAIL_SERVER": "smtp.example.com",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_cors_origins_come_from_frontend_and_landing_addresses():
    settings = make_settings(LANDING_URL="http://localhost:4321")
    assert settings.BACKEND_CORS_ORIGINS == ["http://localhost:5173", "http://localhost:4321"]


def test_cors_extras_are_appended_normalized_and_deduplicated():
    settings = make_settings(
        LANDING_URL="http://localhost:4321/",
        BACKEND_CORS_ORIGINS=[
            "http://localhost:5173/",
            "https://app.example.com/",
            "https://app.example.com",
        ],
    )
    assert settings.BACKEND_CORS_ORIGINS == [
        "http://localhost:5173",
        "http://localhost:4321",
        "https://app.example.com",
    ]


@pytest.mark.parametrize(
    ("url", "port", "expected"),
    [
        ("http://localhost:16000/", 5173, "http://localhost:16000"),
        ("https://app.example.com", 443, "https://app.example.com"),
        ("http://app.example.com", 80, "http://app.example.com"),
        ("https://app.example.com", 8443, "https://app.example.com:8443"),
    ],
)
def test_frontend_origin_does_not_duplicate_or_add_default_ports(url, port, expected):
    settings = make_settings(VITE_FRONTEND_URL=url, VITE_FRONTEND_PORT=port)
    assert settings.BACKEND_CORS_ORIGINS == [expected]


def test_trusted_hosts_include_local_names_backend_hosts_and_lan_ip():
    settings = make_settings(
        BACKEND_HOST_URL="http://api.local",
        BACKEND_PUBLIC_BASE_URL="https://api.example.com/root",
        LAN_BIND_IP="192.168.1.50",
        BACKEND_TRUSTED_HOSTS=["extra.example.com", "localhost"],
    )
    assert settings.BACKEND_TRUSTED_HOSTS == [
        "localhost",
        "127.0.0.1",
        "backend",
        "api.local",
        "api.example.com",
        "192.168.1.50",
        "extra.example.com",
    ]


def test_trusted_hosts_without_optional_values_are_the_local_names():
    settings = make_settings()
    assert settings.BACKEND_TRUSTED_HOSTS == ["localhost", "127.0.0.1", "backend"]


def test_firmware_download_base_uses_the_lan_ip_when_not_set():
    settings = make_settings(LAN_BIND_IP="192.168.1.50", BACKEND_PORT="9000")
    assert settings.FIRMWARE_DOWNLOAD_BASE_URL == "http://192.168.1.50:9000"


def test_explicit_firmware_download_base_wins_over_the_lan_ip():
    settings = make_settings(
        LAN_BIND_IP="192.168.1.50", FIRMWARE_DOWNLOAD_BASE_URL="https://ota.example.com"
    )
    assert settings.FIRMWARE_DOWNLOAD_BASE_URL == "https://ota.example.com"


def test_firmware_download_base_stays_unset_without_lan_ip():
    assert make_settings().FIRMWARE_DOWNLOAD_BASE_URL is None


@pytest.mark.parametrize(
    "field",
    [
        "LAN_BIND_IP",
        "LANDING_URL",
        "BACKEND_PUBLIC_BASE_URL",
        "FIRMWARE_DOWNLOAD_BASE_URL",
        "EMQX_API_KEY",
        "EMQX_API_SECRET",
    ],
)
def test_empty_optional_values_from_compose_mean_unset(field):
    # Compose passes `${VAR:-}` as an empty string when the variable is absent.
    assert getattr(make_settings(**{field: "  "}), field) is None
