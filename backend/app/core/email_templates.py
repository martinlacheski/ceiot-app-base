from datetime import datetime
from html import escape


def _safe(value: str) -> str:
    return escape(value, quote=True)


def _email_shell(*, brand: str, title: str, content: str) -> str:
    safe_brand = _safe(brand)
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{_safe(title)}</title>
</head>
<body style="font-family: Arial, sans-serif; color: #18181b; line-height: 1.6;">
  <div style="max-width: 640px; margin: 0 auto; padding: 24px; border: 1px solid #e4e4e7; border-radius: 12px;">
    <div style="font-size: 22px; font-weight: 700; margin-bottom: 24px;">{safe_brand}</div>
    {content}
    <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;">
    <p style="font-size: 12px; color: #71717a;">&copy; {datetime.now().year} {safe_brand}</p>
  </div>
</body>
</html>"""


def _action_link(label: str, url: str) -> str:
    return (
        f'<a href="{_safe(url)}" '
        'style="display: inline-block; background: #18181b; color: #ffffff; '
        'padding: 10px 16px; border-radius: 6px; text-decoration: none;">'
        f"{_safe(label)}</a>"
    )


def _optional_contact_line(label: str, value: str | None) -> str:
    if not value:
        return ""
    return f"<p><strong>{_safe(label)}:</strong> {_safe(value)}</p>"


def get_contact_email_html(
    *,
    brand: str,
    name: str,
    email: str,
    company: str | None,
    phone: str | None,
    message: str,
) -> str:
    safe_message = _safe(message).replace("\n", "<br>")
    content = f"""
    <h1>Nueva consulta desde la landing</h1>
    <p>Se recibió una nueva consulta comercial desde el sitio de {_safe(brand)}.</p>
    <p><strong>Nombre:</strong> {_safe(name)}</p>
    <p><strong>Email:</strong> {_safe(email)}</p>
    {_optional_contact_line("Empresa", company)}
    {_optional_contact_line("Teléfono", phone)}
    <p><strong>Mensaje:</strong></p>
    <p>{safe_message}</p>
    """
    return _email_shell(brand=brand, title="Nueva consulta", content=content)


def get_contact_email_text(
    *,
    brand: str,
    name: str,
    email: str,
    company: str | None,
    phone: str | None,
    message: str,
) -> str:
    lines = [f"Nueva consulta desde la landing de {brand}", "", f"Nombre: {name}", f"Email: {email}"]
    if company:
        lines.append(f"Empresa: {company}")
    if phone:
        lines.append(f"Teléfono: {phone}")
    lines.extend(["", "Mensaje:", message])
    return "\n".join(lines)


def get_verification_template(verify_url: str, brand: str) -> str:
    content = f"""
    <h1>Verificá tu cuenta</h1>
    <p>Gracias por registrarte. Para empezar a usar tu cuenta, verificá tu correo electrónico.</p>
    {_action_link("Verificar cuenta", verify_url)}
    <p>Si no creaste esta cuenta, no tenés que hacer nada.</p>
    """
    return _email_shell(brand=brand, title="Verificá tu cuenta", content=content)


def get_password_reset_template(username: str, reset_url: str, brand: str) -> str:
    content = f"""
    <h1>Restablecé tu contraseña</h1>
    <p>Hola, <strong>{_safe(username)}</strong>.</p>
    <p>Recibimos una solicitud para restablecer tu contraseña. Si fuiste vos, usá el siguiente enlace, válido por 5 minutos.</p>
    {_action_link("Restablecer contraseña", reset_url)}
    <p>Si no solicitaste este cambio, podés ignorar este correo.</p>
    """
    return _email_shell(brand=brand, title="Restablecé tu contraseña", content=content)


def get_invitation_template(
    environment_name: str, owner_email: str, invite_url: str, brand: str
) -> str:
    content = f"""
    <h1>Te invitaron</h1>
    <p><strong>{_safe(owner_email)}</strong> te invitó a visualizar <strong>{_safe(environment_name)}</strong> en {_safe(brand)}.</p>
    {_action_link("Ver invitación", invite_url)}
    <p>Si no esperabas esta invitación, podés ignorarla.</p>
    """
    return _email_shell(brand=brand, title="Invitación a un establecimiento", content=content)
