import uuid
from typing import Optional

from sqlalchemy import String, case, cast, delete, exists, func, or_
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.device.device_type.constants import (
    DEFAULT_DEVICE_TYPE_CODE,
    DEFAULT_DEVICE_TYPE_ID,
    DEFAULT_DEVICE_TYPE_NAME,
)
from app.api.device.device_type.models import (
    DeviceTypeAdminRead,
    DeviceTypeCatalog,
    DeviceTypeSensor,
    DeviceTypeSensorInput,
    DeviceTypeSensorRead,
)
from app.api.sensor_catalog.models import Sensor, SensorVariable, Variable
from app.api.sensor_catalog.schemas import SensorVariableRead
from app.core.search import ILIKE_ESCAPE, ilike_pattern

SORTABLE = {
    "code",
    "name",
    "hardware_model",
    "telemetry_interval_s",
    "offline_after_s",
    "min_sensors",
    "sensors",
    "is_active",
}
TEXT_SORTS = {"code", "name", "hardware_model"}


class DeviceTypeRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, device_type: DeviceTypeCatalog) -> DeviceTypeCatalog:
        self.db.add(device_type)
        await self.db.commit()
        await self.db.refresh(device_type)
        return device_type

    async def get_by_id(self, type_id: uuid.UUID) -> Optional[DeviceTypeCatalog]:
        query = select(DeviceTypeCatalog).where(DeviceTypeCatalog.id == type_id)
        result = await self.db.exec(query)
        return result.first()

    async def get_by_name(
        self,
        name: str,
        is_active: Optional[bool] = True,
    ) -> Optional[DeviceTypeCatalog]:
        query = select(DeviceTypeCatalog).where(
            func.lower(DeviceTypeCatalog.name) == name.lower()
        )
        if is_active is not None:
            query = query.where(DeviceTypeCatalog.is_active == is_active)

        result = await self.db.exec(query)
        return result.first()

    async def get_by_code(self, code: str) -> Optional[DeviceTypeCatalog]:
        result = await self.db.exec(
            select(DeviceTypeCatalog).where(func.lower(DeviceTypeCatalog.code) == code.lower())
        )
        return result.first()

    async def get_default(self) -> Optional[DeviceTypeCatalog]:
        return await self.get_by_id(DEFAULT_DEVICE_TYPE_ID)

    async def ensure_default_exists(self) -> DeviceTypeCatalog:
        existing = await self.get_default()
        if existing:
            changed = False
            if not existing.is_active:
                existing.is_active = True
                changed = True
            if existing.id == DEFAULT_DEVICE_TYPE_ID and existing.code != DEFAULT_DEVICE_TYPE_CODE:
                existing.code = DEFAULT_DEVICE_TYPE_CODE
                changed = True
            if changed:
                self.db.add(existing)
                await self.db.commit()
                await self.db.refresh(existing)
            return existing

        default_type = DeviceTypeCatalog(
            id=DEFAULT_DEVICE_TYPE_ID,
            name=DEFAULT_DEVICE_TYPE_NAME,
            code=DEFAULT_DEVICE_TYPE_CODE,
            min_sensors=1,
            is_active=True,
        )
        self.db.add(default_type)
        await self.db.commit()
        await self.db.refresh(default_type)
        return default_type

    async def resolve_catalog_type(
        self,
        *,
        device_type_id: Optional[uuid.UUID] = None,
        require_active: bool = False,
    ) -> Optional[DeviceTypeCatalog]:
        if device_type_id is not None:
            if device_type_id == DEFAULT_DEVICE_TYPE_ID:
                resolved = await self.ensure_default_exists()
                if resolved.is_active or not require_active:
                    return resolved
                return None

            resolved = await self.get_by_id(device_type_id)
            if resolved and (resolved.is_active or not require_active):
                return resolved
            return None

        return await self.ensure_default_exists()

    # --- compatible sensors -------------------------------------------------

    async def sensor_links(self, type_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[DeviceTypeSensorRead]]:
        """Compatible sensors (with their variables) of the given types, ordered by sensor code."""
        result: dict[uuid.UUID, list[DeviceTypeSensorRead]] = {type_id: [] for type_id in type_ids}
        if not type_ids:
            return result
        links = (
            await self.db.exec(
                select(DeviceTypeSensor, Sensor)
                .join(Sensor, Sensor.id == DeviceTypeSensor.sensor_id)
                .where(col(DeviceTypeSensor.device_type_id).in_(type_ids))
                .order_by(Sensor.code)
            )
        ).all()
        sensor_ids = list({sensor.id for _, sensor in links})
        variables: dict[uuid.UUID, list[SensorVariableRead]] = {sensor_id: [] for sensor_id in sensor_ids}
        if sensor_ids:
            rows = (
                await self.db.exec(
                    select(SensorVariable, Variable)
                    .join(Variable, Variable.id == SensorVariable.variable_id)
                    .where(col(SensorVariable.sensor_id).in_(sensor_ids))
                    .order_by(Variable.code)
                )
            ).all()
            for link, variable in rows:
                variables[link.sensor_id].append(
                    SensorVariableRead(
                        code=variable.code,
                        name=variable.name,
                        unit=variable.unit,
                        min=link.min_value,
                        max=link.max_value,
                        accuracy=link.accuracy,
                        resolution=link.resolution,
                    )
                )
        for link, sensor in links:
            result[link.device_type_id].append(
                DeviceTypeSensorRead(
                    sensor_id=sensor.id,
                    code=sensor.code,
                    name=sensor.name,
                    manufacturer=sensor.manufacturer,
                    is_active=sensor.is_active,
                    required=link.required,
                    max_count=link.max_count,
                    included_by_default=link.included_by_default,
                    variables=variables[sensor.id],
                )
            )
        return result

    async def to_admin_read(self, device_types: list[DeviceTypeCatalog]) -> list[DeviceTypeAdminRead]:
        links = await self.sensor_links([item.id for item in device_types])
        return [
            DeviceTypeAdminRead(
                id=item.id,
                code=item.code,
                name=item.name,
                description=item.description,
                hardware_model=item.hardware_model,
                telemetry_interval_s=item.telemetry_interval_s,
                offline_after_s=item.offline_after_s,
                min_sensors=item.min_sensors,
                config_template=item.config_template or {},
                is_active=item.is_active,
                created_at=item.created_at,
                updated_at=item.updated_at,
                sensors=links[item.id],
            )
            for item in device_types
        ]

    async def linked_sensor_ids(self, type_id: uuid.UUID) -> set[uuid.UUID]:
        rows = await self.db.exec(
            select(DeviceTypeSensor.sensor_id).where(DeviceTypeSensor.device_type_id == type_id)
        )
        return set(rows.all())

    async def replace_sensors(self, type_id: uuid.UUID, sensors: list[DeviceTypeSensorInput]) -> None:
        await self.db.execute(delete(DeviceTypeSensor).where(DeviceTypeSensor.device_type_id == type_id))
        self.db.add_all(
            DeviceTypeSensor(
                device_type_id=type_id,
                sensor_id=row.sensor_id,
                required=row.required,
                max_count=row.max_count,
                included_by_default=row.included_by_default,
            )
            for row in sensors
        )

    # --- listing -------------------------------------------------------------

    @staticmethod
    def _state_search(search: str, pattern: str):
        label = search.strip()[:64].casefold()
        column = DeviceTypeCatalog.is_active
        if label == "activo":
            return column.is_(True)
        if label == "inactivo":
            return column.is_(False)
        return case((column.is_(True), "Activo"), else_="Inactivo").ilike(pattern, escape=ILIKE_ESCAPE)

    async def get_all(
        self,
        page: int = 1,
        per_page: int = 10,
        is_active: Optional[bool] = None,
        search: Optional[str] = None,
        sort: Optional[str] = None,
        hardware_model: Optional[str] = None,
        sensor_id: Optional[uuid.UUID] = None,
    ) -> dict:
        await self.ensure_default_exists()

        query = select(DeviceTypeCatalog)
        if is_active is not None:
            query = query.where(DeviceTypeCatalog.is_active == is_active)
        if hardware_model:
            query = query.where(
                func.lower(DeviceTypeCatalog.hardware_model) == hardware_model.strip().lower()
            )
        if sensor_id is not None:
            query = query.where(
                exists(
                    select(DeviceTypeSensor.device_type_id).where(
                        DeviceTypeSensor.device_type_id == DeviceTypeCatalog.id,
                        DeviceTypeSensor.sensor_id == sensor_id,
                    )
                )
            )

        pattern = ilike_pattern(search)
        if pattern is not None:
            like = lambda column: column.ilike(pattern, escape=ILIKE_ESCAPE)  # noqa: E731
            query = query.where(
                or_(
                    like(DeviceTypeCatalog.code),
                    like(DeviceTypeCatalog.name),
                    like(DeviceTypeCatalog.description),
                    like(DeviceTypeCatalog.hardware_model),
                    like(cast(DeviceTypeCatalog.telemetry_interval_s, String)),
                    like(cast(DeviceTypeCatalog.offline_after_s, String)),
                    like(cast(DeviceTypeCatalog.min_sensors, String)),
                    self._state_search(search or "", pattern),
                    exists(
                        select(DeviceTypeSensor.device_type_id)
                        .join(Sensor, Sensor.id == DeviceTypeSensor.sensor_id)
                        .where(
                            DeviceTypeSensor.device_type_id == DeviceTypeCatalog.id,
                            or_(like(Sensor.code), like(Sensor.name), like(Sensor.manufacturer)),
                        )
                    ),
                )
            )

        total = (
            await self.db.exec(select(func.count()).select_from(query.subquery()))
        ).one()

        # nullif turns "no compatible sensors" into NULL so NULLS LAST keeps those types at the end.
        sensor_count = func.nullif(
            select(func.count(DeviceTypeSensor.sensor_id))
            .where(DeviceTypeSensor.device_type_id == DeviceTypeCatalog.id)
            .correlate(DeviceTypeCatalog)
            .scalar_subquery(),
            0,
        )
        columns = {
            "code": DeviceTypeCatalog.code,
            "name": DeviceTypeCatalog.name,
            "hardware_model": DeviceTypeCatalog.hardware_model,
            "telemetry_interval_s": DeviceTypeCatalog.telemetry_interval_s,
            "offline_after_s": DeviceTypeCatalog.offline_after_s,
            "min_sensors": DeviceTypeCatalog.min_sensors,
            "sensors": sensor_count,
            "is_active": DeviceTypeCatalog.is_active,
        }
        ordering = []
        for part in (sort or "name:asc").split(","):
            field, _, direction = part.partition(":")
            field = field.strip()
            if field not in SORTABLE or direction.lower() not in ("", "asc", "desc"):
                continue
            expression = func.lower(columns[field]) if field in TEXT_SORTS else columns[field]
            ordered = expression.desc() if direction.lower() == "desc" else expression.asc()
            ordering.append(ordered.nulls_last())
        # Code first so equal rows keep a predictable order; id only guarantees uniqueness.
        query = query.order_by(*ordering, DeviceTypeCatalog.code.asc(), DeviceTypeCatalog.id.asc())

        items = (
            await self.db.exec(query.offset((page - 1) * per_page).limit(per_page))
        ).all()
        return {
            "items": await self.to_admin_read(list(items)),
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
        }

    async def delete(self, type_id: uuid.UUID) -> bool:
        device_type = await self.get_by_id(type_id)
        if not device_type:
            return False

        device_type.is_active = False
        self.db.add(device_type)
        await self.db.commit()
        return True
