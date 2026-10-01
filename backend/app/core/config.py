from typing import Literal

from pydantic import EmailStr, SecretStr, model_validator
from pydantic_settings import (
    BaseSettings,
    SettingsConfigDict,
)


class Settings(BaseSettings):
    # Configuración del .env en Pydantic v2
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Backend
    BACKEND_HOST_URL: str
    BACKEND_PORT: str
    BACKEND_PUBLIC_BASE_URL: str | None = None

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

    # CORS
    BACKEND_CORS_ORIGINS: list[str] = []
    BACKEND_TRUSTED_HOSTS: list[str] = []

    # Variables del Proyecto
    PROJECT_NAME: str
    ENVIRONMENT: str
    MAX_UPLOAD_MB: int

    # MQTT
    MQTT_CLIENT_ID: str
    MQTT_TOPIC_DEVICE_SUB: str
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

    # Social Auth Settings (Optional)
    GOOGLE_OAUTH_ENABLED: bool = False
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    FACEBOOK_CLIENT_ID: str | None = None
    FACEBOOK_CLIENT_SECRET: str | None = None


settings = Settings()
