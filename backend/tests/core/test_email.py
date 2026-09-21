from types import SimpleNamespace

import pytest  # type: ignore[import-not-found]

from app.core import email


class FastMailSpy:
    sent_messages = []
    connections = []

    def __init__(self, connection):
        self.connections.append(connection)

    async def send_message(self, message):
        self.sent_messages.append(message)


@pytest.fixture(autouse=True)
def reset_fast_mail_spy(monkeypatch):
    FastMailSpy.sent_messages = []
    FastMailSpy.connections = []
    monkeypatch.setattr(email, "FastMail", FastMailSpy)


def mail_settings(**overrides):
    values = {
        "MAIL_TRANSPORT": "smtp",
        "MAIL_USERNAME": "synthetic-user",
        "MAIL_PASSWORD": "synthetic-password",
        "MAIL_FROM": "sender@example.com",
        "MAIL_PORT": 587,
        "MAIL_SERVER": "smtp.example.com",
        "MAIL_FROM_NAME": "Monitoreo Ambiental IoT",
        "MAIL_STARTTLS": True,
        "MAIL_SSL_TLS": False,
        "MAIL_USE_CREDENTIALS": True,
        "MAIL_VALIDATE_CERTS": True,
        "CONTACT_RECIPIENT": None,
        "VITE_FRONTEND_URL": "https://app.example.com",
        "VITE_FRONTEND_PORT": 443,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_build_frontend_url_does_not_duplicate_existing_port():
    config = mail_settings(
        VITE_FRONTEND_URL="http://localhost:5173", VITE_FRONTEND_PORT=80
    )

    assert (
        email.build_frontend_url("/invitations/accept?id=abc", config)
        == "http://localhost:5173/invitations/accept?id=abc"
    )


def test_build_frontend_url_appends_non_default_port_when_missing():
    config = mail_settings(
        VITE_FRONTEND_URL="http://localhost", VITE_FRONTEND_PORT=5173
    )

    assert (
        email.build_frontend_url("/auth/verify-email?token=abc", config)
        == "http://localhost:5173/auth/verify-email?token=abc"
    )


def test_build_frontend_url_uses_production_url_without_default_port():
    config = mail_settings(
        VITE_FRONTEND_URL="https://app.example.com", VITE_FRONTEND_PORT=443
    )

    assert (
        email.build_frontend_url("/auth/reset-password?token=abc", config)
        == "https://app.example.com/auth/reset-password?token=abc"
    )


def test_smtp_connection_preserves_configured_values_and_secure_defaults():
    config = email.build_mail_connection_config(mail_settings())

    assert config.MAIL_SERVER == "smtp.example.com"
    assert config.MAIL_PORT == 587
    assert config.MAIL_USERNAME == "synthetic-user"
    assert config.MAIL_PASSWORD.get_secret_value() == "synthetic-password"
    assert str(config.MAIL_FROM) == "sender@example.com"
    assert config.MAIL_STARTTLS is True
    assert config.MAIL_SSL_TLS is False
    assert config.USE_CREDENTIALS is True
    assert config.VALIDATE_CERTS is True


def test_mailpit_connection_ignores_external_smtp_values_and_flags():
    config = email.build_mail_connection_config(
        mail_settings(
            MAIL_TRANSPORT="mailpit",
            MAIL_SERVER="external.example.com",
            MAIL_PORT=465,
            MAIL_USERNAME="external-user",
            MAIL_STARTTLS=True,
            MAIL_SSL_TLS=True,
            MAIL_USE_CREDENTIALS=True,
            MAIL_VALIDATE_CERTS=True,
        )
    )

    assert config.MAIL_SERVER == "mailpit"
    assert config.MAIL_PORT == 1025
    assert config.MAIL_USERNAME == ""
    assert config.MAIL_PASSWORD.get_secret_value() == ""
    assert config.MAIL_STARTTLS is False
    assert config.MAIL_SSL_TLS is False
    assert config.USE_CREDENTIALS is False
    assert config.VALIDATE_CERTS is False


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"MAIL_TRANSPORT": "smpt"}, "MAIL_TRANSPORT"),
        ({"MAIL_STARTTLS": True, "MAIL_SSL_TLS": True}, "mutually exclusive"),
    ],
)
def test_connection_rejects_invalid_transport_or_tls(overrides, message):
    with pytest.raises(ValueError, match=message):
        email.build_mail_connection_config(mail_settings(**overrides))


def test_contact_recipient_uses_from_fallback_or_override():
    assert email.get_contact_recipient(mail_settings()) == "sender@example.com"
    assert (
        email.get_contact_recipient(
            mail_settings(CONTACT_RECIPIENT="contact@example.com")
        )
        == "contact@example.com"
    )


class GlobalSettingsGuard:
    def __getattr__(self, name):
        raise AssertionError(f"global settings accessed: {name}")


@pytest.mark.asyncio
async def test_four_email_flows_use_only_explicit_config(monkeypatch):
    config = mail_settings(
        MAIL_TRANSPORT="mailpit",
        MAIL_FROM_NAME='Sensor <script>alert("x")</script>',
        CONTACT_RECIPIENT="contact@example.com",
    )
    monkeypatch.setattr(email, "settings", GlobalSettingsGuard())
    service = email.EmailService(config=config)

    await service.send_verification_email("verify@example.com", 'verify&token="1"')
    await service.send_password_reset_email(
        "reset@example.com", '<img src=x onerror="bad">', 'reset&token="2"'
    )
    await service.send_invitation_email(
        "invite@example.com",
        '<script>environment</script>',
        'owner"<owner@example.com>',
        'invite&identifier="3"',
    )
    await service.send_contact_email(
        name='<b title="bad">Visitor</b>',
        email_from="visitor@example.com",
        company="<script>company</script>",
        phone='123"><img src=x>',
        message_text="Hello <script>bad</script>",
    )

    assert len(FastMailSpy.sent_messages) == 4
    assert len(FastMailSpy.connections) == 4
    assert all(connection.MAIL_SERVER == "mailpit" for connection in FastMailSpy.connections)
    assert all(str(connection.MAIL_FROM) == "sender@example.com" for connection in FastMailSpy.connections)
    verification, reset, invitation, contact = FastMailSpy.sent_messages

    assert "verify-email?token=verify&amp;token=&quot;1&quot;" in verification.body
    assert "reset-password?token=reset&amp;token=&quot;2&quot;" in reset.body
    assert "invitations/accept?id=invite&amp;identifier=&quot;3&quot;" in invitation.body
    assert "<script>" not in "".join(message.body for message in FastMailSpy.sent_messages)
    assert "<img" not in "".join(message.body for message in FastMailSpy.sent_messages)
    assert "&lt;script&gt;environment&lt;/script&gt;" in invitation.body
    assert "owner&quot;&lt;owner@example.com&gt;" in invitation.body
    assert "&lt;b title=&quot;bad&quot;&gt;Visitor&lt;/b&gt;" in contact.body

    for message in FastMailSpy.sent_messages:
        assert 'Sensor &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;' in message.body
        assert "DVEM" not in message.subject

    assert str(contact.recipients[0].email) == "contact@example.com"
    assert str(contact.reply_to[0].email) == "visitor@example.com"
    assert str(FastMailSpy.connections[-1].MAIL_FROM) == "sender@example.com"
    assert "Hello <script>bad</script>" in contact.alternative_body
    assert contact.multipart_subtype.value == "alternative"


@pytest.mark.asyncio
async def test_no_arg_service_resolves_runtime_global_settings(monkeypatch):
    runtime_config = mail_settings(
        MAIL_TRANSPORT="mailpit",
        MAIL_FROM_NAME="Runtime Synthetic Brand",
        VITE_FRONTEND_URL="https://runtime.example.com",
    )
    monkeypatch.setattr(email, "settings", runtime_config)

    await email.EmailService().send_verification_email(
        "recipient@example.com", "runtime-token"
    )

    assert len(FastMailSpy.sent_messages) == 1
    assert FastMailSpy.connections[0].MAIL_SERVER == "mailpit"
    message = FastMailSpy.sent_messages[0]
    assert "Runtime Synthetic Brand" in message.subject
    assert "https://runtime.example.com/auth/verify-email?token=runtime-token" in message.body
