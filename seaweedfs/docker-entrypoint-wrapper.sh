#!/bin/sh
set -eu

# Renders the S3 identities file from S3_ACCESS_KEY / S3_SECRET_KEY into a
# container-local path (never under the bind-mounted ./data), so the secret
# never touches the host disk or a tracked file. Same idea as
# mqtt/docker-entrypoint-wrapper.sh.
#
# Without credentials the service refuses to serve: SeaweedFS with no
# identities would accept anonymous S3 requests from anything on app-network.
# It idles (instead of exiting) so `restart: unless-stopped` does not
# crash-loop; the healthcheck reports it unhealthy and the log says why.

CONFIG_DIR="/etc/seaweedfs"
CONFIG_FILE="$CONFIG_DIR/s3.json"

if [ -z "${S3_ACCESS_KEY:-}" ] || [ -z "${S3_SECRET_KEY:-}" ]; then
  echo "WARNING: S3_ACCESS_KEY / S3_SECRET_KEY are not set (seaweedfs/.env)." >&2
  echo "WARNING: object storage is DISABLED; documents are unavailable until both are set." >&2
  exec sleep 2147483647
fi

# Values go straight into JSON: reject characters that would break or inject.
case "$S3_ACCESS_KEY$S3_SECRET_KEY" in
  *[\"\\]*|*[[:space:]]*|*[[:cntrl:]]*)
    echo "ERROR: S3 credentials must not contain quotes, backslashes or whitespace." >&2
    exec sleep 2147483647
    ;;
esac

mkdir -p "$CONFIG_DIR"
{
  printf '{"identities":[{"name":"backend","credentials":[{"accessKey":"%s","secretKey":"%s"}],' \
    "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
  printf '"actions":["Admin","Read","Write","List","Tagging"]}]}\n'
} > "$CONFIG_FILE"
chown seaweed:seaweed "$CONFIG_DIR" "$CONFIG_FILE"
chmod 700 "$CONFIG_DIR"
chmod 600 "$CONFIG_FILE"

# Do not leak the secret into the weed process environment listing.
unset S3_SECRET_KEY

exec /entrypoint.sh "$@"
