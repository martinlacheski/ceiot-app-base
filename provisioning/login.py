#!/usr/bin/env python3
"""Log in to the CEIoT backend and store the access token for provision.py.

Reads the username and password from environment variables (never from the
command line, never printed; the password falls back to an interactive
prompt) and writes CEIOT_API_BASE_URL and CEIOT_API_TOKEN to
provisioning/.env.local, which is gitignored and created with mode 0600.
The account needs device and sensor write permissions (an administrator).
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path
from urllib import error, parse, request

from provision import DEFAULT_API_BASE_URL, expand_vars, stack_lookup

PROVISIONING_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = PROVISIONING_DIR / ".env.local"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Store a CEIoT API token in provisioning/.env.local.")
    parser.add_argument("--api-base-url", default=os.environ.get("CEIOT_API_BASE_URL"),
                        help=f"Backend URL (default: CEIOT_API_BASE_URL, the env file or {DEFAULT_API_BASE_URL}).")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--username-env", default="CEIOT_PROVISIONING_USERNAME",
                        help="Environment variable holding the username.")
    parser.add_argument("--password-env", default="CEIOT_PROVISIONING_PASSWORD",
                        help="Environment variable holding the password (else prompted).")
    return parser.parse_args(argv)


def parse_env_file(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


def env_value(lines: list[str], key: str) -> str | None:
    for line in lines:
        stripped = line.strip().removeprefix("export ").strip()
        if stripped.startswith(f"{key}="):
            return stripped.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def update_env_lines(lines: list[str], values: dict[str, str]) -> list[str]:
    """Replaces the given keys in place and appends the missing ones."""
    seen: set[str] = set()
    updated: list[str] = []
    for line in lines:
        stripped = line.strip().removeprefix("export ").strip()
        key = stripped.split("=", 1)[0].strip() if "=" in stripped else ""
        if key in values:
            updated.append(f'{key}="{values[key]}"')
            seen.add(key)
        else:
            updated.append(line)
    updated.extend(f'{key}="{value}"' for key, value in values.items() if key not in seen)
    return updated


def login(api_base_url: str, username: str, password: str) -> str:
    base = api_base_url.rstrip("/")
    root = base if base.endswith("/api") else f"{base}/api"
    body = parse.urlencode({"username": username, "password": password}).encode("utf-8")
    http_request = request.Request(f"{root}/auth/login", data=body, method="POST", headers={
        "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
    try:
        with request.urlopen(http_request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        raise RuntimeError(f"Login failed with {exc.code}: {exc.read().decode('utf-8', errors='replace')}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Cannot reach the API at {root}: {exc.reason}") from exc
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("The login response has no access_token.")
    return token


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    env_file = args.env_file.expanduser().resolve()
    lines = parse_env_file(env_file)
    api_base_url = args.api_base_url or env_value(lines, "CEIOT_API_BASE_URL") or expand_vars(
        DEFAULT_API_BASE_URL, stack_lookup({}))
    username = os.environ.get(args.username_env)
    if not username:
        raise RuntimeError(f"Set {args.username_env} to the account username.")
    password = os.environ.get(args.password_env) or getpass.getpass(f"Password for {username}: ")
    token = login(api_base_url, username, password)

    content = "\n".join(update_env_lines(lines, {
        "CEIOT_API_BASE_URL": api_base_url.rstrip("/"), "CEIOT_API_TOKEN": token})) + "\n"
    env_file.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(content)
    os.chmod(env_file, 0o600)
    print(f"Token stored in {env_file} (CEIOT_API_TOKEN, not shown).")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
