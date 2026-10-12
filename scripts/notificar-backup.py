#!/usr/bin/env python3
"""Send a backup failure notification through the application's own mailer.

Called by scripts/backup-cron.sh when a scheduled backup fails or is skipped.
The e-mail is sent from inside the backend container (``docker compose exec -T
backend python -``) with ``app.core.email.build_mail_connection_config``, so it
uses the same transport as the application: Mailpit in development
(MAIL_TRANSPORT=mailpit), the configured SMTP server in production. No mail
credential ever leaves the container or reaches this host.

Recipient: BACKUP_NOTIFY_EMAIL when it is set, otherwise the first active
administrator (``is_admin`` and ``is_active``, oldest account first).

Exit codes: 0 sent, 1 send error, 3 backend container not running,
4 no recipient available.

Usage:
  scripts/notificar-backup.py --estado failed --codigo 1 --resumen "..." \
      --backup backups/<fecha> --log backups/logs/backup-<fecha>.log
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LOG_TAIL_LINES = 40
EXIT_SEND_ERROR = 1
EXIT_BACKEND_DOWN = 3
EXIT_NO_RECIPIENT = 4

STATUS_TEXT = {
    "failed": "falló",
    "skipped": "se omitió (otro backup seguía en curso)",
}

# Runs inside the backend container; PAYLOAD is replaced by a JSON literal.
CONTAINER_SCRIPT = r'''
import asyncio
import json
import sys

from fastapi_mail import FastMail, MessageSchema, MessageType
from sqlalchemy import text

from app.core.config import settings
from app.core.email import build_mail_connection_config

payload = json.loads(PAYLOAD)


async def first_admin():
    from app.core.db import async_engine, system_session

    try:
        async with system_session() as session:
            row = (
                await session.execute(
                    text(
                        'SELECT email FROM "user" WHERE is_admin AND is_active '
                        "ORDER BY created_at LIMIT 1"
                    )
                )
            ).first()
        return row[0] if row else None
    finally:
        await async_engine.dispose()


async def main():
    recipient = payload["recipient"] or await first_admin()
    if not recipient:
        print("No hay destinatario: definí BACKUP_NOTIFY_EMAIL o creá un administrador activo.")
        return 4
    message = MessageSchema(
        subject=payload["subject"] + " - " + settings.MAIL_FROM_NAME,
        recipients=[recipient],
        body=payload["body"],
        subtype=MessageType.plain,
    )
    try:
        await FastMail(build_mail_connection_config()).send_message(message)
    except Exception as exc:  # report the kind of failure, never the settings
        print("No se pudo enviar la notificación (%s: %s)." % (type(exc).__name__, str(exc)[:200]))
        return 1
    print("Notificación enviada a %s (MAIL_TRANSPORT=%s)." % (recipient, settings.MAIL_TRANSPORT))
    return 0


sys.exit(asyncio.run(main()))
'''


def log_tail(path: str, lines: int = LOG_TAIL_LINES) -> str:
    try:
        content = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return "(no se pudo leer el log)"
    return "\n".join(content[-lines:])


def build_message(args: argparse.Namespace, host: str) -> tuple[str, str]:
    what = STATUS_TEXT.get(args.estado, args.estado)
    subject = "Backup programado: %s en %s" % ("falló" if args.estado == "failed" else "omitido", host)
    body = "\n".join(
        [
            "El backup programado de ceiot-app-base %s." % what,
            "",
            "Equipo: %s" % host,
            "Proyecto: %s" % REPO,
            "Código de salida: %s" % args.codigo,
            "Carpeta del backup: %s" % (args.backup or "(no se generó)"),
            "Resumen: %s" % args.resumen,
            "Log completo: %s" % args.log,
            "",
            "Últimas líneas del log:",
            "",
            log_tail(args.log),
            "",
            "Estado de la última ejecución: scripts/instalar-backup-cron.sh estado",
        ]
    )
    return subject, body


def container_script(payload: dict) -> str:
    # json.dumps twice: a JSON document inside a Python string literal.
    return CONTAINER_SCRIPT.replace("PAYLOAD", json.dumps(json.dumps(payload)), 1)


def backend_running() -> bool:
    proc = subprocess.run(
        ["docker", "compose", "ps", "-q", "--status", "running", "backend"],
        cwd=REPO, capture_output=True, text=True, check=False,
    )
    return proc.returncode == 0 and bool(proc.stdout.strip())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--estado", required=True, help="failed o skipped")
    parser.add_argument("--codigo", default="?", help="código de salida de scripts/backup.sh")
    parser.add_argument("--resumen", default="")
    parser.add_argument("--backup", default="")
    parser.add_argument("--log", default="")
    args = parser.parse_args(argv)

    subject, body = build_message(args, socket.gethostname())
    if not backend_running():
        print("No se pudo enviar la notificación: el contenedor backend no está corriendo.")
        return EXIT_BACKEND_DOWN
    payload = {
        "recipient": os.environ.get("BACKUP_NOTIFY_EMAIL", "").strip(),
        "subject": subject,
        "body": body,
    }
    try:
        proc = subprocess.run(
            ["docker", "compose", "exec", "-T", "backend", "python", "-"],
            cwd=REPO, input=container_script(payload), capture_output=True, text=True,
            timeout=120, check=False,
        )
    except subprocess.TimeoutExpired:
        print("No se pudo enviar la notificación: el backend no respondió en 120 s.")
        return EXIT_SEND_ERROR
    output = proc.stdout.strip()
    if proc.returncode != 0 and not output:
        # A traceback can be long; its last line names the error.
        errors = [line for line in proc.stderr.splitlines() if line.strip()]
        output = "No se pudo enviar la notificación: %s" % (errors[-1][:200] if errors else "sin detalle")
    print(output)
    if proc.returncode in (0, EXIT_NO_RECIPIENT):
        return proc.returncode
    return EXIT_SEND_ERROR


if __name__ == "__main__":
    sys.exit(main())
