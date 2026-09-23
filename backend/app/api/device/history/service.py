"""Snapshot-scoped history queries; no access decision uses current device ownership."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import String, and_, cast, false, func, or_, select, true, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.auth.models import User
from app.api.device.history.query_utils import format_local, formatted_time, ordered, text_search
from app.api.device.history.serial import OPERATION_SERIAL, READING_SERIAL
from app.api.device.models import Device
from app.api.device.operations.models import DeviceOperation
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.sensor.models import SensorReading
from app.core.labels_es import OPERATION_STATUS_LABELS, OPERATION_TYPE_LABELS, codes_matching_label


@dataclass(frozen=True)
class HistoryScope:
    unrestricted: bool = False
    member_environment_ids: frozenset[uuid.UUID] = frozenset()
    guest_starts: dict[uuid.UUID, datetime] = field(default_factory=dict)

    def condition(self, environment_column, time_column, environment_id=None, *, members_only=False):
        if self.unrestricted:
            scope = true()
        else:
            parts = []
            if self.member_environment_ids:
                parts.append(environment_column.in_(self.member_environment_ids))
            if not members_only:
                for env_id, starts_at in self.guest_starts.items():
                    if env_id not in self.member_environment_ids:
                        parts.append(and_(environment_column == env_id, time_column >= starts_at))
            scope = or_(*parts) if parts else false()
        if environment_id is not None:
            scope = and_(scope, environment_column == environment_id)
        return scope


@dataclass(frozen=True)
class ReadingFilters:
    temp_min: float | None = None
    temp_max: float | None = None
    humidity_min: float | None = None
    humidity_max: float | None = None
    pressure_min: float | None = None
    pressure_max: float | None = None
    has_error: bool | None = None
    firmware_version: str | None = None

    def conditions(self):
        conditions = []
        for value, column, op in (
            (self.temp_min, SensorReading.temperature_c, "min"),
            (self.temp_max, SensorReading.temperature_c, "max"),
            (self.humidity_min, SensorReading.relative_humidity_pct, "min"),
            (self.humidity_max, SensorReading.relative_humidity_pct, "max"),
            (self.pressure_min, SensorReading.pressure_hpa, "min"),
            (self.pressure_max, SensorReading.pressure_hpa, "max"),
        ):
            if value is not None:
                conditions.append(column >= value if op == "min" else column <= value)
        if self.has_error is not None:
            error = and_(SensorReading.last_error.is_not(None), SensorReading.last_error != "")
            conditions.append(error if self.has_error else ~error)
        if self.firmware_version:
            conditions.append(SensorReading.firmware_version == self.firmware_version)
        return conditions


def _matches_search(entry, search, utc_offset_minutes):
    # The list is already aggregated in Python: substring matching treats '%' and
    # '_' literally. Detail SQL searches use core.search.ilike_pattern to escape them.
    term = (search or "").strip().casefold()
    if not term:
        return True
    fields = [entry.get(key) for key in ("serial", "device_name", "environment_name", "owner_name",
                                         "readings_count", "operations_count", "is_former")]
    for key in ("first_seen", "last_seen"):
        value = entry.get(key)
        base = value.astimezone(timezone.utc) if value and value.tzinfo else value
        fields.extend((format_local(value, utc_offset_minutes),
                       (base + timedelta(minutes=utc_offset_minutes)).date().isoformat() if base else ""))
    return any(term in str(value).casefold() for value in fields if value is not None)


_SORT_KEYS = {key: (lambda entry, key=key: entry.get(key)) for key in (
    "serial", "device_name", "environment_name", "owner_name", "first_seen", "last_seen",
    "readings_count", "operations_count")}


def _sorted_entries(entries, sort_by, sort_order):
    key = _SORT_KEYS[sort_by]
    # Stable serial/environment tie-break, independent of requested direction.
    entries = sorted(entries, key=lambda entry: (entry["serial"], str(entry["environment_id"])))
    populated = [entry for entry in entries if key(entry) is not None]
    missing = [entry for entry in entries if key(entry) is None]
    populated.sort(key=lambda entry: key(entry).casefold() if isinstance(key(entry), str) else key(entry),
                   reverse=sort_order == "desc")
    return populated + missing


def _page(items, page, per_page):
    total = len(items)
    return {"items": items[(page - 1) * per_page:page * per_page], "total": total,
            "page": page, "per_page": per_page, "pages": (total + per_page - 1) // per_page}


class DeviceHistoryService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def resolve_scope(self, user: User) -> HistoryScope:
        if user.is_admin:
            return HistoryScope(unrestricted=True)
        members = (await self.session.execute(select(EnvironmentUser.environment_id).where(
            EnvironmentUser.user_id == user.id, EnvironmentUser.is_active.is_(True)))).scalars().all()
        guests = (await self.session.execute(select(
            ScopedGuestRelation.scope_id, func.min(ScopedGuestRelation.access_starts_at)).where(
                ScopedGuestRelation.scope_type == ScopeType.ENVIRONMENT,
                ScopedGuestRelation.guest_user_id == user.id,
                ScopedGuestRelation.is_active.is_(True),
                ScopedGuestRelation.access_starts_at <= func.now(),
            ).group_by(ScopedGuestRelation.scope_id))).all()
        return HistoryScope(member_environment_ids=frozenset(members), guest_starts=dict(guests))

    async def list_entries(self, scope, environment_id=None, serial=None, *, include_owner=False):
        """One UNION ALL aggregate for both row types; metadata queries are batched."""
        from sqlalchemy import literal
        # literal() must be typed as a SQL expression, not cast from a Python string.
        def branch(model, serial_column, kind, members_only):
            predicates = [serial_column.is_not(None), serial_column != "", model.environment_id.is_not(None),
                          scope.condition(model.environment_id, model.time, environment_id,
                                          members_only=members_only)]
            if serial:
                predicates.append(serial_column == serial)
            return select(serial_column.label("serial"), model.environment_id.label("environment_id"),
                          func.count().label("total"), func.min(model.time).label("first_seen"),
                          func.max(model.time).label("last_seen"), literal(kind).label("kind")).where(
                              *predicates).group_by(serial_column, model.environment_id)
        combined = union_all(branch(DeviceOperation, OPERATION_SERIAL, "operation", False),
                             branch(SensorReading, READING_SERIAL, "reading", True))
        rows = (await self.session.execute(combined)).all()
        entries = {}
        for row in rows:
            key = (row.serial, row.environment_id)
            item = entries.setdefault(key, {"serial": row.serial, "environment_id": row.environment_id,
                                            "first_seen": None, "last_seen": None,
                                            "readings_count": 0, "operations_count": 0})
            item["readings_count" if row.kind == "reading" else "operations_count"] = row.total
            item["first_seen"] = min(filter(None, (item["first_seen"], row.first_seen)))
            item["last_seen"] = max(filter(None, (item["last_seen"], row.last_seen)))
        if not entries:
            return []
        env_ids = {key[1] for key in entries}
        serials = {key[0] for key in entries}
        names = dict((await self.session.execute(select(Environment.id, Environment.name).where(
            Environment.id.in_(env_ids)))).all())
        current = {(row.serial, row.environment_id): row.name for row in
                   (await self.session.execute(select(Device.serial, Device.environment_id, Device.name).where(
                       Device.environment_id.in_(env_ids), Device.serial.in_(serials),
                       Device.is_active.is_(True)))).all()}
        owners = {}
        if include_owner:
            for env_id, user_id, first, last, username in (await self.session.execute(select(
                EnvironmentUser.environment_id, User.id, User.first_name, User.last_name, User.username
            ).join(User, User.id == EnvironmentUser.user_id).where(
                EnvironmentUser.environment_id.in_(env_ids), EnvironmentUser.is_owner.is_(True),
                EnvironmentUser.is_active.is_(True)))).all():
                owners[env_id] = (user_id, f"{first or ''} {last or ''}".strip() or username)
        current_serials = {key[0] for key in current}
        result = []
        for key, item in entries.items():
            owner_id, owner_name = owners.get(item["environment_id"], (None, None))
            result.append({**item, "environment_name": names.get(item["environment_id"]),
                           "device_name": current.get(key),
                           "is_former": key not in current if scope.unrestricted else item["serial"] not in current_serials,
                           "owner_id": owner_id, "owner_name": owner_name})
        return result

    async def list_devices(self, user, *, environment_id=None, only_former=True, search=None,
                           last_seen_from=None, last_seen_to=None, owner_id=None,
                           sort_by="last_seen", sort_order="desc", utc_offset_minutes=0,
                           page=1, per_page=10):
        scope = await self.resolve_scope(user)
        entries = await self.list_entries(scope, environment_id, include_owner=user.is_admin)
        if only_former:
            entries = [entry for entry in entries if entry["is_former"]]
        if owner_id is not None and user.is_admin:
            entries = [entry for entry in entries if entry["owner_id"] == owner_id]
        def matches(entry):
            value = entry["last_seen"]
            utc_value = value.astimezone(timezone.utc) if value.tzinfo else value
            local_day = (utc_value + timedelta(minutes=utc_offset_minutes)).date()
            return ((last_seen_from is None or local_day >= last_seen_from)
                    and (last_seen_to is None or local_day <= last_seen_to)
                    and _matches_search(entry, search, utc_offset_minutes))
        return _page(_sorted_entries([entry for entry in entries if matches(entry)],
                                     sort_by, sort_order), page, per_page)

    async def has_history(self, scope, serial, environment_id=None):
        return bool(await self.list_entries(scope, environment_id, serial))

    async def list_sensor_readings(self, scope, *, serial, environment_id=None, filters=None,
                                   search=None, sort_by="time", sort_order="desc",
                                   utc_offset_minutes=0, page=1, per_page=100):
        filters = filters or ReadingFilters()
        query = select(SensorReading).where(SensorReading.device_serial == serial,
            scope.condition(SensorReading.environment_id, SensorReading.time, environment_id,
                            members_only=True), *filters.conditions())
        match = text_search(search, formatted_time(SensorReading.time, utc_offset_minutes),
            SensorReading.device_serial, SensorReading.device_type, SensorReading.power_supply_state,
            SensorReading.temperature_c, SensorReading.relative_humidity_pct, SensorReading.pressure_hpa,
            SensorReading.uptime, SensorReading.firmware_version, SensorReading.reset_reason,
            SensorReading.heap_free, SensorReading.wifi_rssi, SensorReading.wifi_ssid,
            SensorReading.wifi_ip, SensorReading.last_error, SensorReading.device_datetime)
        if match is not None:
            query = query.where(match)
        total = (await self.session.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
        columns = {key: getattr(SensorReading, key) for key in (
            "time", "temperature_c", "relative_humidity_pct", "pressure_hpa", "firmware_version",
            "wifi_rssi", "uptime", "heap_free")}
        query = query.order_by(ordered(columns[sort_by], sort_order),
                               SensorReading.time.desc(), SensorReading.id.asc()).offset(
                                   (page - 1) * per_page).limit(per_page)
        items = (await self.session.execute(query)).scalars().all()
        return {"items": items, "total": total, "page": page, "per_page": per_page,
                "pages": (total + per_page - 1) // per_page}

    async def list_operations(self, scope, *, serial, environment_id=None, status=None,
                              operation_type=None, search=None, sort_by="time", sort_order="desc",
                              utc_offset_minutes=0, page=1, per_page=20):
        query = select(DeviceOperation).where(DeviceOperation.device_serial == serial,
            scope.condition(DeviceOperation.environment_id, DeviceOperation.time, environment_id))
        if status is not None:
            query = query.where(DeviceOperation.status == status)
        if operation_type is not None:
            query = query.where(DeviceOperation.operation_type == operation_type)
        match = text_search(search, formatted_time(DeviceOperation.time, utc_offset_minutes),
                            DeviceOperation.id, DeviceOperation.device_serial,
                            DeviceOperation.operation_type, DeviceOperation.status)
        label_matches = []
        for column, labels in ((DeviceOperation.operation_type, OPERATION_TYPE_LABELS),
                               (DeviceOperation.status, OPERATION_STATUS_LABELS)):
            codes = codes_matching_label(search or "", labels)
            if codes:
                label_matches.append(func.lower(cast(column, String)).in_({code.lower() for code in codes}))
        if match is not None:
            query = query.where(or_(match, *label_matches))
        total = (await self.session.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
        columns = {"time": DeviceOperation.time, "id": DeviceOperation.id,
                   "operation_type": cast(DeviceOperation.operation_type, String),
                   "status": cast(DeviceOperation.status, String)}
        query = query.order_by(ordered(columns[sort_by], sort_order),
                               DeviceOperation.time.desc(), DeviceOperation.id.asc()).offset(
                                   (page - 1) * per_page).limit(per_page)
        return {"items": (await self.session.execute(query)).scalars().all(), "total": total,
                "page": page, "per_page": per_page, "pages": (total + per_page - 1) // per_page}
