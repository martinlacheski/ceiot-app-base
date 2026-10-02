"""Latitude/longitude helpers shared by the environment model and the public map.

The legacy ``environment.location`` column stores a ``"lat,lng"`` string (or a Google
Maps URL containing one). ``latitude``/``longitude`` are the typed source of truth;
this parser is the single place that turns the legacy text into numbers.
"""
import re

_LAT_LNG_RE = re.compile(r"([-+]?\d{1,2}\.\d+),\s*([-+]?\d{1,3}\.\d+)")
_MAPS_AT_RE = re.compile(r"@([-+]?\d{1,2}\.\d+),([-+]?\d{1,3}\.\d+)")
_MAPS_Q_RE = re.compile(r"[?&]q=([-+]?\d{1,2}\.\d+),([-+]?\d{1,3}\.\d+)")

LATITUDE_RANGE = (-90.0, 90.0)
LONGITUDE_RANGE = (-180.0, 180.0)


def in_range(latitude: float, longitude: float) -> bool:
    return (
        LATITUDE_RANGE[0] <= latitude <= LATITUDE_RANGE[1]
        and LONGITUDE_RANGE[0] <= longitude <= LONGITUDE_RANGE[1]
    )


def parse_lat_lng(location: str | None) -> tuple[float, float] | None:
    """Parse ``"lat,lng"`` / ``"lat, lng"`` or a Google Maps URL into ``(lat, lng)``.

    Returns ``None`` when the text holds no coordinates or they are out of range.
    """
    if not location:
        return None

    for pattern in (_LAT_LNG_RE, _MAPS_AT_RE, _MAPS_Q_RE):
        match = pattern.search(location)
        if match:
            try:
                latitude, longitude = float(match.group(1)), float(match.group(2))
            except ValueError:
                return None
            return (latitude, longitude) if in_range(latitude, longitude) else None
    return None


def format_location(latitude: float, longitude: float) -> str:
    """Legacy ``location`` text for a numeric pair."""
    return f"{latitude},{longitude}"
