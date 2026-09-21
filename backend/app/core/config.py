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
