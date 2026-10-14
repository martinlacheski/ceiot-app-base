#!/bin/sh
set -eu

# Renders the built-in-database bootstrap CSV for the shared backend user
# from EMQX_BACKEND_PASSWORD (never printed) into a container-local path
# that is NOT under any bind-mounted host directory, so the plaintext
# password never touches the host disk. EMQX hashes it on load
# (bootstrap_type=plain) and stores only the hash in its own database
# (mqtt/data/mnesia, already git-ignored).

BOOT_DIR="/tmp/emqx-bootstrap"
BOOT_FILE="$BOOT_DIR/backend-users.csv"

: "${EMQX_BACKEND_PASSWORD:?EMQX_BACKEND_PASSWORD is required (set it in mqtt/.env)}"

mkdir -p "$BOOT_DIR"
{
  echo "user_id,password,is_superuser"
  printf '%s,%s,false\n' "backend-services" "$EMQX_BACKEND_PASSWORD"
} > "$BOOT_FILE"
chmod 600 "$BOOT_FILE"

export EMQX_AUTHENTICATION__1__BOOTSTRAP_FILE="$BOOT_FILE"

# Optional management API key used by the backend for device presence
# (EMQX_API_KEY / EMQX_API_SECRET in the root .env, shared with the backend).
# Bootstrapped on every start, so it survives an empty database instead of
# having to be recreated by hand in the dashboard. Same container-local path.
if [ -n "${EMQX_API_KEY:-}" ] && [ -n "${EMQX_API_SECRET:-}" ]; then
  API_KEY_FILE="$BOOT_DIR/api-keys"
  printf '%s:%s:administrator\n' "$EMQX_API_KEY" "$EMQX_API_SECRET" > "$API_KEY_FILE"
  chmod 600 "$API_KEY_FILE"
  export EMQX_API_KEY__BOOTSTRAP_FILE="$API_KEY_FILE"
  unset EMQX_API_KEY EMQX_API_SECRET
fi

exec /usr/bin/docker-entrypoint.sh "$@"
