import logging

from app.core.logging_config import quiet_http_client_logs


def test_quiet_http_client_logs_raises_httpx_and_httpcore_to_warning():
    logging.getLogger("httpx").setLevel(logging.INFO)
    logging.getLogger("httpcore").setLevel(logging.INFO)

    quiet_http_client_logs()

    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING


def test_quiet_http_client_logs_does_not_touch_unrelated_loggers():
    logging.getLogger("app.api.location.service").setLevel(logging.INFO)

    quiet_http_client_logs()

    assert logging.getLogger("app.api.location.service").level == logging.INFO
