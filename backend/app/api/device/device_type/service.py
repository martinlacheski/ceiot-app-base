import uuid
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select

from app.api.device.device_type.constants import DEFAULT_DEVICE_TYPE_ID
from app.api.device.device_type.models import (
    DeviceTypeAdminRead,
    DeviceTypeCatalog,
    DeviceTypeCreate,
    DeviceTypeSensorInput,
    DeviceTypeUpdate,
)
from app.api.device.device_type.repository import DeviceTypeRepository
from app.api.sensor_catalog.models import Sensor

NAME_CONFLICT = "Ya existe un tipo de dispositivo con ese nombre"
CODE_CONFLICT = "Ya existe un tipo de dispositivo con ese código"


class DeviceTypeService:
    def __init__(self, repo: DeviceTypeRepository):
        self.repo = repo

    async def _validate_sensors(
        self,
        sensors: list[DeviceTypeSensorInput],
        min_sensors: int,
        already_linked: set[uuid.UUID],
    ) -> None:
        ids = [row.sensor_id for row in sensors]
        found = {
            sensor.id: sensor
            for sensor in (
                await self.repo.db.exec(select(Sensor).where(col(Sensor.id).in_(ids)))
            ).all()
        } if ids else {}
        for sensor_id in ids:
            sensor = found.get(sensor_id)
            if sensor is None:
                raise HTTPException(422, "El modelo de sensor no existe")
            if not sensor.is_active and sensor_id not in already_linked:
                raise HTTPException(422, f"El modelo de sensor {sensor.name} está inactivo")
        capacity = sum(row.max_count for row in sensors)
        if min_sensors > capacity:
            raise HTTPException(
                422,
                "El mínimo de sensores supera la cantidad máxima de sensores compatibles"
                if sensors
                else "Para exigir sensores hay que agregar al menos un sensor compatible",
            )

    async def _ensure_unique(
        self,
        name: Optional[str],
        code: Optional[str],
        own_id: Optional[uuid.UUID] = None,
    ) -> None:
        if name:
            existing = await self.repo.get_by_name(name, is_active=None)
            if existing and existing.id != own_id:
                raise HTTPException(status.HTTP_409_CONFLICT, NAME_CONFLICT)
        if code:
            existing = await self.repo.get_by_code(code)
            if existing and existing.id != own_id:
                raise HTTPException(status.HTTP_409_CONFLICT, CODE_CONFLICT)

    async def _read(self, device_type: DeviceTypeCatalog) -> DeviceTypeAdminRead:
        return (await self.repo.to_admin_read([device_type]))[0]

    async def create(self, payload: DeviceTypeCreate) -> DeviceTypeAdminRead:
        await self._ensure_unique(payload.name, payload.code)
        await self._validate_sensors(payload.sensors, payload.min_sensors, set())
        device_type = DeviceTypeCatalog(
            **payload.model_dump(exclude={"sensors"}),
        )
        db = self.repo.db
        # SAVEPOINT: a full rollback would also revert the uncommitted RLS identity of this session.
        try:
            async with db.begin_nested():
                db.add(device_type)
                await db.flush()
                await self.repo.replace_sensors(device_type.id, payload.sensors)
        except IntegrityError:
            raise HTTPException(status.HTTP_409_CONFLICT, NAME_CONFLICT) from None
        await db.commit()
        await db.refresh(device_type)
        return await self._read(device_type)

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
        return await self.repo.get_all(
            page, per_page, is_active, search, sort, hardware_model, sensor_id
        )

    async def get_by_id(self, type_id: uuid.UUID) -> DeviceTypeAdminRead:
        device_type = await self.repo.get_by_id(type_id)
        if not device_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device type not found",
            )
        return await self._read(device_type)

    async def update(
        self,
        type_id: uuid.UUID,
        payload: DeviceTypeUpdate,
    ) -> DeviceTypeAdminRead:
        device_type = await self.repo.get_by_id(type_id)
        if not device_type:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device type not found",
            )
        changes = payload.model_dump(exclude_unset=True, exclude={"sensors"})
        if "code" in changes and changes["code"] != device_type.code:
            raise HTTPException(status.HTTP_409_CONFLICT, "El código del tipo es inmutable")
        changes.pop("code", None)
        for required in ("name", "min_sensors", "config_template", "is_active"):
            if required in changes and changes[required] is None:
                raise HTTPException(422, f"{required} no puede ser nulo")
        if changes.get("is_active") is False and type_id == DEFAULT_DEVICE_TYPE_ID:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "El tipo Ambiental es el predeterminado y no se puede desactivar"
            )

        await self._ensure_unique(changes.get("name"), None, own_id=type_id)

        # Validate the final state: the new set (or the current one) against the final minimum.
        replace = "sensors" in payload.model_fields_set
        if replace and payload.sensors is None:
            raise HTTPException(422, "sensors no puede ser nulo")
        final_min = changes.get("min_sensors", device_type.min_sensors)
        telemetry = changes.get("telemetry_interval_s", device_type.telemetry_interval_s)
        offline = changes.get("offline_after_s", device_type.offline_after_s)
        if telemetry is not None and offline is not None and offline < telemetry:
            raise HTTPException(422, "offlineAfterS must be greater than or equal to telemetryIntervalS")
        linked = await self.repo.linked_sensor_ids(type_id)
        if replace:
            await self._validate_sensors(payload.sensors, final_min, linked)
        elif "min_sensors" in changes:
            current = [
                DeviceTypeSensorInput(sensor_id=row.sensor_id, max_count=row.max_count)
                for row in (await self.repo.sensor_links([type_id]))[type_id]
            ]
            await self._validate_sensors(current, final_min, linked)

        db = self.repo.db
        try:
            async with db.begin_nested():
                for key, value in changes.items():
                    setattr(device_type, key, value)
                db.add(device_type)
                if replace:
                    await db.flush()
                    await self.repo.replace_sensors(type_id, payload.sensors)
        except IntegrityError:
            raise HTTPException(status.HTTP_409_CONFLICT, NAME_CONFLICT) from None
        await db.commit()
        await db.refresh(device_type)
        return await self._read(device_type)

    async def delete(self, type_id: uuid.UUID) -> DeviceTypeAdminRead:
        return await self.update(type_id, DeviceTypeUpdate(is_active=False))
