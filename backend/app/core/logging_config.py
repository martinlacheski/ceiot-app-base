import logging

# httpx (and httpcore) log every outgoing request at INFO, including the full
# URL. Query strings can carry API keys (e.g. GCP_API_KEY for geocoding), so
# those loggers must never run below WARNING.
_QUIET_HTTP_CLIENT_LOGGERS = ("httpx", "httpcore")


def quiet_http_client_logs() -> None:
    """Silence INFO-level request logging from HTTP client libraries."""
    for name in _QUIET_HTTP_CLIENT_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
