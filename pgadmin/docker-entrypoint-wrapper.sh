#!/bin/sh
# Renders the preconfigured server + passfile in /tmp (container-only, 0600),
# then hands over to the stock pgAdmin entrypoint.
set -eu
umask 077

: "${PGADMIN_DB_NAME:?}" "${PGADMIN_DB_USER:?}" "${PGADMIN_DB_PASSWORD:?}"

# libpq passfile format: ':' and '\' inside fields must be backslash-escaped.
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/:/\\:/g'; }
printf 'postgresql:5432:*:%s:%s\n' "$(esc "$PGADMIN_DB_USER")" "$(esc "$PGADMIN_DB_PASSWORD")" > /tmp/pgpass

python3 - <<'PY' > /tmp/servers.json
import json, os
print(json.dumps({"Servers": {"1": {
    "Name": "IoT App (TimescaleDB)",
    "Group": "Servers",
    "Host": "postgresql",
    "Port": 5432,
    "MaintenanceDB": os.environ["PGADMIN_DB_NAME"],
    "Username": os.environ["PGADMIN_DB_USER"],
    "SSLMode": "prefer",
    "PassFile": "/tmp/pgpass",
}}}))
PY

exec /entrypoint.sh "$@"
