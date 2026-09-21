"""
Public API — no authentication required.

All endpoints in this router are accessible without a JWT token.
Only non-sensitive, publicly-safe data is returned.
"""

# pyright: reportMissingImports=false

import re
import time
import uuid
from collections import deque
from collections.abc import Iterable
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlmodel import col, select

from app.api.device.models import Device, DeviceStatus
from app.api.environment.environment.models import Environment
from app.api.location.models import LocationCity, LocationState
from app.core.db import get_async_session
from app.core.email import EmailService

router = APIRouter()

PUBLIC_CONTACT_SUCCESS_MESSAGE = "Consulta enviada correctamente."
PUBLIC_CONTACT_RATE_LIMIT_MESSAGE = "Too many contact requests. Please try again later."
PUBLIC_CONTACT_PROVIDER_ERROR_MESSAGE = (
    "Contact service is temporarily unavailable. Please try again later."
)


class PublicContactRateLimiter:
    def __init__(self, *, limit: int, window_seconds: int, now=time.monotonic):
        self.limit = limit
        self.window_seconds = window_seconds
        self.now = now
        self._attempts: dict[str, deque[float]] = {}
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        current_time = self.now()

        with self._lock:
            attempts = self._attempts.setdefault(key, deque())
            cutoff = current_time - self.window_seconds

            while attempts and attempts[0] <= cutoff:
                attempts.popleft()

            if len(attempts) >= self.limit:
                return False

            attempts.append(current_time)
            return True


contact_rate_limiter = PublicContactRateLimiter(limit=5, window_seconds=600)


# ---------------------------------------------------------------------------
# Response schema — minimal, no sensitive fields
# ---------------------------------------------------------------------------


class PublicDeviceResponse(BaseModel):
    """Minimal device info safe to expose publicly."""

    id: str
    name: str
    lat: float
    lng: float
    status: str  # "online", "offline", "alert"


class PublicContactRequest(BaseModel):
    name: str = Field(min_length=4, max_length=120)
    email: EmailStr
    company: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    message: str = Field(min_length=10, max_length=2000)
    website: str | None = Field(default=None, max_length=120)

    @field_validator("name", "message", mode="before")
    @classmethod
    def trim_required_fields_before_length_validation(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value

    @field_validator("company", "phone", "website")
    @classmethod
    def normalize_optional_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None

        trimmed = value.strip()
        return trimmed or None


class PublicContactResponse(BaseModel):
    message: str


class PublicMapLocationResponse(BaseModel):
    display_name: str = Field(alias="displayName")
    latitude: float
    longitude: float
    city: str | None = None
    state: str | None = None
    country: str | None = None
    active_device_count: int = Field(alias="activeDeviceCount")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_LAT_LNG_RE = re.compile(r"([-+]?\d{1,2}\.\d+),\s*([-+]?\d{1,3}\.\d+)")
_MAPS_AT_RE = re.compile(r"@([-+]?\d{1,2}\.\d+),([-+]?\d{1,3}\.\d+)")
_MAPS_Q_RE = re.compile(r"[?&]q=([-+]?\d{1,2}\.\d+),([-+]?\d{1,3}\.\d+)")


def _parse_location(location: str) -> tuple[float, float] | None:
    """
    Parse a location string to (lat, lng).

    Accepts:
    - "lat,lng"  or  "lat, lng"
    - Google Maps URL containing @lat,lng or ?q=lat,lng
    Returns None if the string cannot be parsed as coordinates.
    """
    if not location:
        return None

    try:
        # Plain "lat,lng"
        m = _LAT_LNG_RE.search(location)
        if m:
            return float(m.group(1)), float(m.group(2))

        # Google Maps URL — @lat,lng
        m = _MAPS_AT_RE.search(location)
        if m:
            return float(m.group(1)), float(m.group(2))

        # Google Maps URL — ?q=lat,lng
        m = _MAPS_Q_RE.search(location)
        if m:
            return float(m.group(1)), float(m.group(2))
    except ValueError:
        return None

    return None


def _device_status_to_public(status: DeviceStatus) -> str:
    """Map internal DeviceStatus to public-facing status string."""
    if status == DeviceStatus.ACTIVE:
        return "online"
    if status == DeviceStatus.MAINTENANCE:
        return "alert"
    return "offline"


def _build_public_map_location(
    environment: Environment,
    coords: tuple[float, float],
    active_device_count: int,
) -> PublicMapLocationResponse:
    city: LocationCity | None = environment.city
    state = city.state if city else None
    country = state.country if state else None
    latitude, longitude = coords

    return PublicMapLocationResponse(
        displayName=environment.name,
        latitude=latitude,
        longitude=longitude,
        city=city.name if city else None,
        state=state.name if state else None,
        country=country.name if country else None,
        activeDeviceCount=active_device_count,
    )


def _build_public_map_locations(devices: Iterable[Device]) -> list[PublicMapLocationResponse]:
    grouped_locations: dict[uuid.UUID, PublicMapLocationResponse] = {}
    active_device_counts: dict[uuid.UUID, int] = {}

    for device in devices:
        environment: Environment | None = device.environment
        if (
            not environment
            or not environment.is_active
            or not environment.is_public_map_visible
            or not environment.location
        ):
            continue
        if not device.enabled or device.status != DeviceStatus.ACTIVE:
            continue

        coords = _parse_location(environment.location)
        if coords is None or environment.id is None:
            continue

        active_device_counts[environment.id] = active_device_counts.get(environment.id, 0) + 1
        grouped_locations[environment.id] = _build_public_map_location(
            environment=environment,
            coords=coords,
            active_device_count=active_device_counts[environment.id],
        )

    return sorted(grouped_locations.values(), key=lambda location: location.display_name.lower())


def _get_public_request_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        forwarded_ip = forwarded_for.split(",", 1)[0].strip()
        if forwarded_ip:
            return forwarded_ip

    if request.client and request.client.host:
        return request.client.host

    return "unknown"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/map/devices",
    response_model=list[PublicDeviceResponse],
    tags=["public"],
    summary="Public device map data",
    description=(
        "Public endpoint — no authentication required. "
        "Returns minimal device location data for public map display. "
        "Only devices paired to an environment with parseable coordinates are included."
    ),
)
async def get_public_devices(
    session: AsyncSession = Depends(get_async_session),
) -> list[PublicDeviceResponse]:
    """
    Public endpoint — no authentication required.
    Returns minimal device location data for public map display.
    """
    # Fetch all active, paired devices together with their environment
    statement = (
        select(Device)
        .options(selectinload(Device.environment))
        .where(
            col(Device.is_active).is_(True),
            col(Device.environment_id).is_not(None),
        )
    )
    result = await session.exec(statement)
    devices = result.all()

    public_devices: list[PublicDeviceResponse] = []
    for device in devices:
        env: Environment | None = device.environment
        if not env or not env.location:
            continue

        coords = _parse_location(env.location)
        if coords is None:
            continue

        lat, lng = coords
        public_devices.append(
            PublicDeviceResponse(
                id=str(device.id),
                name=device.name,
                lat=lat,
                lng=lng,
                status=_device_status_to_public(device.status),
            )
        )

    return public_devices


@router.get(
    "/map/locations",
    response_model=list[PublicMapLocationResponse],
    tags=["public"],
    summary="Public establishment map data",
    description=(
        "Public endpoint — no authentication required. "
        "Returns a sanitized establishment/location projection for the landing map. "
        "Only explicitly public, active environments with at least one active, enabled device and parseable coordinates are included."
    ),
)
async def get_public_map_locations(
    session: AsyncSession = Depends(get_async_session),
) -> list[PublicMapLocationResponse]:
    statement = (
        select(Device)
        .options(
            selectinload(Device.environment)
            .selectinload(Environment.city)
            .selectinload(LocationCity.state)
            .selectinload(LocationState.country)
        )
        .where(
            col(Device.is_active).is_(True),
            col(Device.environment_id).is_not(None),
        )
    )
    result = await session.exec(statement)
    devices = result.all()

    return _build_public_map_locations(devices)


@router.post(
    "/contact",
    response_model=PublicContactResponse,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["public"],
    summary="Send landing contact request",
)
async def send_public_contact(
    request: Request,
    payload: PublicContactRequest,
) -> PublicContactResponse:
    if payload.website:
        return PublicContactResponse(message=PUBLIC_CONTACT_SUCCESS_MESSAGE)

    client_ip = _get_public_request_ip(request)
    if not contact_rate_limiter.allow(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=PUBLIC_CONTACT_RATE_LIMIT_MESSAGE,
        )

    try:
        await EmailService().send_contact_email(
            name=payload.name,
            email_from=str(payload.email),
            company=payload.company,
            phone=payload.phone,
            message_text=payload.message,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=PUBLIC_CONTACT_PROVIDER_ERROR_MESSAGE,
        ) from exc

    return PublicContactResponse(message=PUBLIC_CONTACT_SUCCESS_MESSAGE)
