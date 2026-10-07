import logging
import re

# httpx (and httpcore) log every outgoing request at INFO, including the full
# URL. Query strings can carry API keys (e.g. GCP_API_KEY for geocoding), so
# those loggers must never run below WARNING.
_QUIET_HTTP_CLIENT_LOGGERS = ("httpx", "httpcore")

# The firmware download URL carries a short-lived token that is its only
# credential: the access log shows the path with the token masked.
_DOWNLOAD_TOKEN = re.compile(r"(/api/firmware/download/)[^/?#\s\"]+")
_ACCESS_LOGGERS = ("uvicorn.access",)


def quiet_http_client_logs() -> None:
    """Silence INFO-level request logging from HTTP client libraries."""
    for name in _QUIET_HTTP_CLIENT_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)


def _mask(value):
    return _DOWNLOAD_TOKEN.sub(r"\1***", value) if isinstance(value, str) else value


class DownloadTokenFilter(logging.Filter):
    """Masks the token of `/api/firmware/download/{token}` in a log record (never drops it)."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _mask(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(_mask(arg) for arg in record.args)
        elif isinstance(record.args, dict):
            record.args = {key: _mask(value) for key, value in record.args.items()}
        return True


def install_download_token_mask() -> None:
    """Attach the mask to the HTTP access loggers (idempotent)."""
    for name in _ACCESS_LOGGERS:
        logger = logging.getLogger(name)
        if not any(isinstance(existing, DownloadTokenFilter) for existing in logger.filters):
            logger.addFilter(DownloadTokenFilter())
