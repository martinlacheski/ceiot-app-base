from typing import Literal
from urllib.parse import urlsplit

from pydantic import EmailStr, SecretStr, field_validator, model_validator
from pydantic_settings import (
    BaseSettings,
    SettingsConfigDict,
)


# Hosts the API always answers to: local tools, the healthcheck and other
# containers on the compose network.
LOCAL_TRUSTED_HOSTS = ("localhost", "127.0.0.1", "backend")
DEFAULT_PORTS = {"http": "80", "https": "443"}


def _dedupe(items: list[str]) -> list[str]:
    return list(dict.fromkeys(item for item in items if item))


def _origin(url: str, port: int | str | None) -> str:
    """`url` plus `port`, unless the URL already has one or it is the scheme default."""
    base = url.strip().rstrip("/")
    parsed = urlsplit(base)
    port = str(port or "").strip()
    if not port or parsed.port is not None or DEFAULT_PORTS.get(parsed.scheme) == port:
        return base
    return f"{base}:{port}"


class Settings(BaseSettings):
    # Configuración del .env en Pydantic v2
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Backend
    BACKEND_HOST_URL: str
    BACKEND_PORT: str
    BACKEND_PUBLIC_BASE_URL: str | None = None
    # Base of the firmware download URL sent to devices in `ota/command`
    # (`{base}/api/firmware/download/{token}`). Must be reachable from the
    # devices (e.g. http://<LAN IP>:<BACKEND_PORT> in development). Falls back
    # to http(s)://LAN_BIND_IP:BACKEND_PORT when LAN_BIND_IP is set, then to
    # BACKEND_PUBLIC_BASE_URL, then BACKEND_HOST_URL.
    FIRMWARE_DOWNLOAD_BASE_URL: str | None = None
    # LAN IP the backend and the MQTT mTLS port are also published on (root
    # .env); real devices reach the API through it.
    LAN_BIND_IP: str | None = None
    # Public landing origin (scheme://host:port), allowed by CORS.
    LANDING_URL: str | None = None

    # Base de datos
    DATABASE_URL: str
    ALEMBIC_DATABASE_URL: str
    # Autenticación
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str
    JWT_EXPIRES_MINUTES: int
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    BOOTSTRAP_ADMIN_USERNAME: str | None = None
    BOOTSTRAP_ADMIN_EMAIL: str | None = None
    BOOTSTRAP_ADMIN_PASSWORD: SecretStr | None = None

    # CORS and trusted hosts. Derived from the frontend, landing and backend
    # addresses (see derive_network_settings); these lists only add extras.
    BACKEND_CORS_ORIGINS: list[str] = []
    BACKEND_TRUSTED_HOSTS: list[str] = []

    # Variables del Proyecto
    PROJECT_NAME: str
    ENVIRONMENT: str
    MAX_UPLOAD_MB: int

    # MQTT
    MQTT_CLIENT_ID: str
    EMQX_HOST: str
    EMQX_PORT: int
    EMQX_USER: str
    EMQX_PASSWORD: str
    EMQX_API_BASE_URL: str | None = None
    EMQX_API_KEY: SecretStr | None = None
    EMQX_API_SECRET: SecretStr | None = None

    # Redis (optional live layer: device state + pulse). Unset or unreachable
    # means the app degrades to database reads and no live pulse.
    REDIS_URL: str | None = None

    # Object storage (SeaweedFS S3 gateway, internal network only). Without
    # the keys the documents module answers 503 "Almacenamiento no configurado".
    S3_ENDPOINT_URL: str | None = None
    S3_BUCKET: str = "ceiot-documents"
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY: SecretStr | None = None
    S3_SECRET_KEY: SecretStr | None = None

    # AI assistant (OpenRouter). Without the key the assistant answers 503
    # "Asistente no configurado"; the rest of the app is unaffected.
    OPENROUTER_API_KEY: SecretStr | None = None
    OPENROUTER_MODEL: str = "openai/gpt-4o-mini"
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_MAX_COMPLETION_TOKENS: int = 400

    # Embeddings for RAG (BAAI/bge-m3, 1024 dimensions). ``openrouter`` reuses
    # OPENROUTER_API_KEY/OPENROUTER_BASE_URL; ``local`` talks to a Text
    # Embeddings Inference container (compose profile ``embeddings-local``) at
    # EMBEDDING_LOCAL_URL and needs no key. Each stored chunk keeps the provider
    # and model that produced it; switching either requires a re-index.
    EMBEDDING_PROVIDER: Literal["openrouter", "local"] = "openrouter"
    EMBEDDING_LOCAL_URL: str | None = None
    MODELO_EMBEDDING: str = "BAAI/bge-m3"

    # RAG retrieval. The cosine-distance cutoff is model specific: recalibrate
    # it if MODELO_EMBEDDING changes (see backend/README.md).
    RAG_MAX_COSINE_DISTANCE: float = 0.55
    RAG_TOP_K: int = 4

    # MQTT Backoff Config (producción)
    MQTT_RETRY_INITIAL_DELAY: int = 1  # Segundos inicial
    MQTT_RETRY_MAX_DELAY: int = 60  # Máximo entre reintentos
    MQTT_RETRY_MAX_ATTEMPTS: int = 0  # 0 = infinito

    # Email Settings
    MAIL_TRANSPORT: Literal["smtp", "mailpit"] = "smtp"
    MAIL_USERNAME: str = ""
    MAIL_PASSWORD: str = ""
    MAIL_FROM: str
    MAIL_PORT: int
    MAIL_SERVER: str
    MAIL_FROM_NAME: str = "Monitoreo Ambiental IoT"
    MAIL_STARTTLS: bool = True
    MAIL_SSL_TLS: bool = False
    MAIL_USE_CREDENTIALS: bool = True
    MAIL_VALIDATE_CERTS: bool = True
    CONTACT_RECIPIENT: EmailStr | None = None

    @model_validator(mode="after")
    def validate_mail_settings(self):
        if self.MAIL_TRANSPORT == "smtp":
            if self.MAIL_STARTTLS and self.MAIL_SSL_TLS:
                raise ValueError("MAIL_STARTTLS and MAIL_SSL_TLS are mutually exclusive")
            if self.MAIL_USE_CREDENTIALS and not (
                self.MAIL_USERNAME.strip() and self.MAIL_PASSWORD
            ):
                raise ValueError(
                    "SMTP credentials are required when MAIL_USE_CREDENTIALS is enabled"
                )
        return self

    # Frontend Settings
    VITE_FRONTEND_URL: str
    VITE_FRONTEND_PORT: int

    @field_validator(
        "BACKEND_PUBLIC_BASE_URL",
        "FIRMWARE_DOWNLOAD_BASE_URL",
        "LAN_BIND_IP",
        "LANDING_URL",
        "EMQX_API_KEY",
        "EMQX_API_SECRET",
        mode="before",
    )
    @classmethod
    def empty_means_unset(cls, value):
        # Compose passes `${VAR:-}` as an empty string when VAR is absent.
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def derive_network_settings(self):
        frontend = _origin(self.VITE_FRONTEND_URL, self.VITE_FRONTEND_PORT)
        landing = [self.LANDING_URL] if self.LANDING_URL else []
        self.BACKEND_CORS_ORIGINS = _dedupe(
            [origin.strip().rstrip("/") for origin in [frontend, *landing, *self.BACKEND_CORS_ORIGINS]]
        )

        backend_hosts = [
            urlsplit(url.strip()).hostname or ""
            for url in (self.BACKEND_HOST_URL, self.BACKEND_PUBLIC_BASE_URL)
            if url
        ]
        self.BACKEND_TRUSTED_HOSTS = _dedupe(
            [
                *LOCAL_TRUSTED_HOSTS,
                *backend_hosts,
                self.LAN_BIND_IP or "",
                *(host.strip() for host in self.BACKEND_TRUSTED_HOSTS),
            ]
        )

        if not self.FIRMWARE_DOWNLOAD_BASE_URL and self.LAN_BIND_IP:
            scheme = urlsplit(self.BACKEND_HOST_URL).scheme or "http"
            self.FIRMWARE_DOWNLOAD_BASE_URL = _origin(
                f"{scheme}://{self.LAN_BIND_IP.strip()}", self.BACKEND_PORT
            )
        return self

    # Social Auth Settings (Optional)
    GOOGLE_OAUTH_ENABLED: bool = False
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    FACEBOOK_CLIENT_ID: str | None = None
    FACEBOOK_CLIENT_SECRET: str | None = None


settings = Settings()
