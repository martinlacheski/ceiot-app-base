"""Protected source-only contract for retiring the Mercado Pago HTTP surface."""

from __future__ import annotations

import inspect
import sys
from pathlib import Path

from app.main import app


_RETIRED_ROUTER_MODULE = "app.api.mercadopago.router"
_RETIRED_ROUTER_SOURCE = Path("app/api/mercadopago/router.py").parts
_RETIRED_EXACT_PATHS = {
    "/api/auth-url",
    "/api/connection",
    "/api/mp-callback",
    "/api/oauth-link",
    "/api/orders",
    "/api/status",
    "/api/success",
    "/api/webhooks/mercadopago",
}
_RETAINED_ROUTES = {
    ("/api/auth/login", "POST"),
    ("/api/devices", "GET"),
    ("/api/environment/", "GET"),
}


def _endpoint_source_parts(route: object) -> tuple[str, ...]:
    endpoint = getattr(route, "endpoint", None)
    if endpoint is None:
        return ()

    source = inspect.getsourcefile(inspect.unwrap(endpoint))
    return Path(source).parts if source else ()


def _mounted_route_keys() -> set[tuple[str, str]]:
    return {
        (route.path, method)
        for route in app.routes
        for method in (getattr(route, "methods", None) or set())
    }


def test_normal_app_composition_omits_the_retired_mp_router_module() -> None:
    assert _RETIRED_ROUTER_MODULE not in sys.modules, (
        "Retired payment router module loaded by normal app composition."
    )


def test_normal_app_composition_has_no_retired_mp_routes() -> None:
    mounted_from_retired_source = sorted(
        route.path
        for route in app.routes
        if _endpoint_source_parts(route)[-len(_RETIRED_ROUTER_SOURCE) :]
        == _RETIRED_ROUTER_SOURCE
    )
    retired_public_paths = sorted(
        route.path
        for route in app.routes
        if route.path in _RETIRED_EXACT_PATHS
        or route.path.startswith("/api/mercadopago/")
    )

    assert mounted_from_retired_source == [], (
        "Retired payment router still mounts public paths: "
        f"{mounted_from_retired_source}"
    )
    assert retired_public_paths == [], (
        "Retired payment path family remains mounted: "
        f"{retired_public_paths}"
    )


def test_generic_auth_environment_and_device_routes_remain_mounted() -> None:
    missing_routes = sorted(_RETAINED_ROUTES.difference(_mounted_route_keys()))

    assert missing_routes == [], f"Generic public routes are missing: {missing_routes}"
