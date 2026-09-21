from typing import Any
from urllib.parse import urlparse

from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType
from fastapi_mail.schemas import MultipartSubtypeEnum

from app.core.config import settings
from app.core.email_templates import (
    get_contact_email_html,
    get_contact_email_text,
    get_invitation_template,
    get_password_reset_template,
    get_verification_template,
)


def _resolve_config(config: Any | None) -> Any:
    return settings if config is None else config


def build_mail_connection_config(config: Any | None = None) -> ConnectionConfig:
    """Build a fresh connection config for the explicitly selected transport."""
    resolved = _resolve_config(config)
    transport = resolved.MAIL_TRANSPORT
    if transport == "mailpit":
        return ConnectionConfig(
            MAIL_USERNAME="",
            MAIL_PASSWORD="",
            MAIL_FROM=resolved.MAIL_FROM,
            MAIL_PORT=1025,
            MAIL_SERVER="mailpit",
            MAIL_FROM_NAME=resolved.MAIL_FROM_NAME,
            MAIL_STARTTLS=False,
            MAIL_SSL_TLS=False,
            USE_CREDENTIALS=False,
            VALIDATE_CERTS=False,
        )

    if transport != "smtp":
        raise ValueError("MAIL_TRANSPORT must be either 'smtp' or 'mailpit'")
    if resolved.MAIL_STARTTLS and resolved.MAIL_SSL_TLS:
        raise ValueError("MAIL_STARTTLS and MAIL_SSL_TLS are mutually exclusive")
    if resolved.MAIL_USE_CREDENTIALS and not (
        resolved.MAIL_USERNAME.strip() and resolved.MAIL_PASSWORD
    ):
        raise ValueError(
            "SMTP credentials are required when MAIL_USE_CREDENTIALS is enabled"
        )

    return ConnectionConfig(
        MAIL_USERNAME=resolved.MAIL_USERNAME,
        MAIL_PASSWORD=resolved.MAIL_PASSWORD,
        MAIL_FROM=resolved.MAIL_FROM,
        MAIL_PORT=resolved.MAIL_PORT,
        MAIL_SERVER=resolved.MAIL_SERVER,
        MAIL_FROM_NAME=resolved.MAIL_FROM_NAME,
        MAIL_STARTTLS=resolved.MAIL_STARTTLS,
        MAIL_SSL_TLS=resolved.MAIL_SSL_TLS,
        USE_CREDENTIALS=resolved.MAIL_USE_CREDENTIALS,
        VALIDATE_CERTS=resolved.MAIL_VALIDATE_CERTS,
    )


def get_contact_recipient(config: Any | None = None) -> str:
    resolved = _resolve_config(config)
    return str(resolved.CONTACT_RECIPIENT or resolved.MAIL_FROM)


def build_frontend_url(path: str, config: Any | None = None) -> str:
    resolved = _resolve_config(config)
    base_url = resolved.VITE_FRONTEND_URL.rstrip("/")
    parsed = urlparse(base_url)
    port = resolved.VITE_FRONTEND_PORT

    if parsed.port is None and port not in {80, 443}:
        base_url = f"{base_url}:{port}"

    normalized_path = path if path.startswith("/") else f"/{path}"
    return f"{base_url}{normalized_path}"


class EmailService:
    def __init__(self, config: Any | None = None):
        self.config = config

    async def _send(self, message: MessageSchema) -> None:
        await FastMail(build_mail_connection_config(self.config)).send_message(message)

    async def send_verification_email(self, email_to: str, token: str):
        config = _resolve_config(self.config)
        verify_url = build_frontend_url(
            f"/auth/verify-email?token={token}", config
        )
        brand = config.MAIL_FROM_NAME
        message = MessageSchema(
            subject=f"Verificá tu cuenta - {brand}",
            recipients=[email_to],
            body=get_verification_template(verify_url, brand),
            subtype=MessageType.html,
        )
        await self._send(message)

    async def send_password_reset_email(
        self, email_to: str, username: str, token: str
    ):
        config = _resolve_config(self.config)
        reset_url = build_frontend_url(
            f"/auth/reset-password?token={token}", config
        )
        brand = config.MAIL_FROM_NAME
        message = MessageSchema(
            subject=f"Restablecé tu contraseña - {brand}",
            recipients=[email_to],
            body=get_password_reset_template(username, reset_url, brand),
            subtype=MessageType.html,
        )
        await self._send(message)

    async def send_invitation_email(
        self,
        email_to: str,
        environment_name: str,
        owner_email: str,
        invitation_id: str,
    ):
        config = _resolve_config(self.config)
        invite_url = build_frontend_url(
            f"/invitations/accept?id={invitation_id}", config
        )
        brand = config.MAIL_FROM_NAME
        message = MessageSchema(
            subject=f"Te invitaron a un establecimiento - {brand}",
            recipients=[email_to],
            body=get_invitation_template(
                environment_name, owner_email, invite_url, brand
            ),
            subtype=MessageType.html,
        )
        await self._send(message)

    async def send_contact_email(
        self,
        *,
        name: str,
        email_from: str,
        company: str | None,
        phone: str | None,
        message_text: str,
    ):
        config = _resolve_config(self.config)
        brand = config.MAIL_FROM_NAME
        message = MessageSchema(
            subject=f"Nueva consulta desde la landing - {brand}",
            recipients=[get_contact_recipient(config)],
            body=get_contact_email_html(
                brand=brand,
                name=name,
                email=email_from,
                company=company,
                phone=phone,
                message=message_text,
            ),
            subtype=MessageType.html,
            multipart_subtype=MultipartSubtypeEnum.alternative,
            reply_to=[email_from],
            alternative_body=get_contact_email_text(
                brand=brand,
                name=name,
                email=email_from,
                company=company,
                phone=phone,
                message=message_text,
            ),
        )
        await self._send(message)
