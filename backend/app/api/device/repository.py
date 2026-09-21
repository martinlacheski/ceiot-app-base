from typing import Optional, Dict, Any, List, Literal
import uuid
from datetime import date, datetime
from sqlalchemy import or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlmodel import select, func
from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.device.device_type.repository import DeviceTypeRepository
from app.api.device.models import (
    Device,
    DeviceCreate,
    DeviceLocationReport,
    DeviceUpdate,
    DeviceStatus,
)
from app.api.device.service import DeviceService
from app.services.pagination import paginate_query_async

from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.location.models import LocationCity, LocationState


class DeviceRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, id: uuid.UUID, include_inactive: bool = False) -> Optional[Device]:
        query = select(Device).options(
            selectinload(Device.type),
            selectinload(Device.environment).selectinload(
                Environment.users).selectinload(EnvironmentUser.user),
            selectinload(Device.environment).selectinload(Environment.type),
            selectinload(Device.environment).selectinload(Environment.city).selectinload(
                LocationCity.state).selectinload(LocationState.country)
        ).where(Device.id == id)
        if not include_inactive:
            query = query.where(Device.is_active == True)
        result = await self.session.exec(query)
        return result.first()

    async def get_by_serial(self, serial: str) -> Optional[Device]:
        # Search case-insensitive? Or assuming normalized?
        # Let's search by normalized serial from service
        normalized = DeviceService.normalize_serial(serial)
        statement = select(Device).options(
            selectinload(Device.type),
        ).where(Device.serial == normalized)
        # We might want even deleted ones for uniqueness check?
        # Usually get_by_... implies active ones, but for unique checks we might check all.
        # Here we return any to let service decide logic.
        result = await self.session.exec(statement)
        return result.first()

    async def rollback(self) -> None:
        await self.session.rollback()

    async def get_all(
        self,
        page: int = 1,
        per_page: int = 20,
        search: Optional[str] = None,
        device_type_id: Optional[uuid.UUID] = None,
        model: Optional[str] = None,
        batch: Optional[str] = None,
        manufacture_date: Optional[str] = None,
        status: Optional[str] = None,
        enabled: Optional[bool] = None,
        is_active: Optional[bool] = None,
        environment_id: Optional[uuid.UUID] = None,
        user_id: Optional[uuid.UUID] = None,
        owner_id: Optional[uuid.UUID] = None,
        sort_by: Literal[
            "name",
            "serial",
            "model",
            "manufactureDate",
            "status",
            "enabled",
            "isActive",
            "lastConnection",
            "brokerConnected",
        ] = "name",
        sort_order: Literal["asc", "desc"] = "asc",
    ) -> Dict[str, Any]:
        query = select(Device).options(
            selectinload(Device.type),
            selectinload(Device.environment).selectinload(
                Environment.users).selectinload(EnvironmentUser.user),
            selectinload(Device.environment).selectinload(Environment.type),
            selectinload(Device.environment).selectinload(Environment.city).selectinload(
                LocationCity.state).selectinload(LocationState.country)
        )

        if is_active is not None:
            query = query.where(Device.is_active == is_active)

        # Filter by User permissions (Owned or Invited environments)
        if user_id:
            environment_member_exists = select(EnvironmentUser.id).where(
                EnvironmentUser.environment_id == Device.environment_id,
                EnvironmentUser.user_id == user_id,
                EnvironmentUser.is_active == True,
            ).exists()
            environment_guest_exists = select(ScopedGuestRelation.id).where(
                ScopedGuestRelation.scope_type == ScopeType.ENVIRONMENT,
                ScopedGuestRelation.scope_id == Device.environment_id,
                ScopedGuestRelation.guest_user_id == user_id,
                ScopedGuestRelation.is_active == True,
            ).exists()
            device_guest_exists = select(ScopedGuestRelation.id).where(
                ScopedGuestRelation.scope_type == ScopeType.DEVICE,
                ScopedGuestRelation.scope_id == Device.id,
                ScopedGuestRelation.guest_user_id == user_id,
                ScopedGuestRelation.is_active == True,
            ).exists()
            query = query.where(
                or_(environment_member_exists, environment_guest_exists, device_guest_exists)
            )

        if environment_id:
            query = query.where(Device.environment_id == environment_id)

        if search:
            search_term = f"%{search}%"
            query = query.where(
                (Device.name.ilike(search_term)) |
                (Device.serial.ilike(search_term)) |
                (Device.description.ilike(search_term)) |
                (Device.model.ilike(search_term)) |
                (Device.batch.ilike(search_term))
            )

        if device_type_id is not None:
            query = query.where(Device.device_type_id == device_type_id)

        if model:
            query = query.where(Device.model.ilike(f"%{model}%"))

        if batch:
            query = query.where(Device.batch.ilike(f"%{batch}%"))

        if manufacture_date:
            # Assuming exact match for date string YYYY-MM-DD
            query = query.where(Device.manufacture_date == manufacture_date)

        if status:
            query = query.where(Device.status == status)

        if enabled is not None:
            query = query.where(Device.enabled == enabled)

        if owner_id:
            from sqlalchemy.orm import aliased
            OwnerEnvUser = aliased(EnvironmentUser)
            query = query.join(OwnerEnvUser, Device.environment_id == OwnerEnvUser.environment_id).where(
                OwnerEnvUser.user_id == owner_id,
                OwnerEnvUser.is_owner == True
            )

        sort_expressions = {
            "name": Device.name,
            "serial": Device.serial,
            "model": Device.model,
            "manufactureDate": Device.manufacture_date,
            "status": Device.status,
            "enabled": Device.enabled,
            "isActive": Device.is_active,
            "lastConnection": Device.last_connection,
            "brokerConnected": Device.broker_connected,
        }
        sort_expression = sort_expressions[sort_by]
        direction = sort_expression.desc if sort_order == "desc" else sort_expression.asc
        ordered_expression = direction()
        if sort_by in {"model", "manufactureDate", "lastConnection"}:
            ordered_expression = ordered_expression.nullslast()
        query = query.order_by(ordered_expression, Device.id.asc())

        return await paginate_query_async(self.session, Device, query, page, per_page)

    async def count(self, environment_id: Optional[uuid.UUID] = None) -> int:
        query = select(func.count()).select_from(
            Device).where(Device.is_active == True)
        if environment_id:
            query = query.where(Device.environment_id == environment_id)
        result = await self.session.exec(query)
        return result.one() or 0

    async def create_with_data(self, device_in: DeviceCreate) -> Device:
        device_type_repo = DeviceTypeRepository(self.session)
        resolved_type = await device_type_repo.resolve_catalog_type(
            device_type_id=device_in.device_type_id,
            require_active=True,
        )
        if resolved_type is None:
            raise ValueError("Invalid device type reference")

        # 1. Create Device
        db_device = Device(
            serial=DeviceService.normalize_serial(device_in.serial),
            name=device_in.name,
            description=device_in.description,
            device_type_id=resolved_type.id,
            model=device_in.model,
            batch=device_in.batch,
            manufacture_date=device_in.manufacture_date,
            status=DeviceStatus.NEW,
            environment_id=None,  # Always created unpaired
        )
        self.session.add(db_device)
        await self.session.flush()  # To get ID

        await self.session.commit()
        return await self.get(db_device.id, include_inactive=True)

    async def update(self, db_device: Device, device_in: DeviceUpdate) -> Device:
        # Update device fields
        if device_in.name is not None:
            db_device.name = device_in.name
        if device_in.description is not None:
            db_device.description = device_in.description
        if device_in.device_type_id is not None:
            resolved_type = await DeviceTypeRepository(self.session).resolve_catalog_type(
                device_type_id=device_in.device_type_id,
                require_active=True,
            )
            if resolved_type is None:
                raise ValueError("Invalid device type reference")
            db_device.device_type_id = resolved_type.id
        if device_in.enabled is not None:
            db_device.enabled = device_in.enabled
        if device_in.is_active is not None:
            db_device.is_active = device_in.is_active

        self.session.add(db_device)
        await self.session.commit()

        # Return fully loaded for response model
        return await self.get(db_device.id, include_inactive=True)

    async def delete(self, db_device: Device) -> None:
        db_device.is_active = False
        db_device.environment_id = None  # Unpair on delete?
        self.session.add(db_device)
        await self.session.commit()

    async def pair(
        self,
        db_device: Device,
        environment_id: uuid.UUID,
        description: str,
    ) -> Device:
        db_device.environment_id = environment_id
        db_device.status = DeviceStatus.PAIRED
        db_device.description = description
        self.session.add(db_device)
        await self.session.commit()

        # Re-fetch with relationships loaded to avoid MissingGreenlet
        return await self.get(db_device.id, include_inactive=True)

    async def unpair(self, db_device: Device) -> Device:
        db_device.environment_id = None
        db_device.status = DeviceStatus.UNPAIRED
        self.session.add(db_device)
        await self.session.commit()

        # Re-fetch with relationships loaded
        return await self.get(db_device.id, include_inactive=True)

    async def get_distinct_manufacture_dates(self) -> List[date]:
        statement = select(Device.manufacture_date).distinct().where(
            Device.manufacture_date != None).order_by(Device.manufacture_date.desc())
        result = await self.session.exec(statement)
        return result.all()

    async def update_last_connection(self, device_id: uuid.UUID) -> None:
        """Actualiza last_connection al timestamp actual"""

        statement = select(Device).where(Device.id == device_id)
        result = await self.session.exec(statement)
        device = result.first()
        if device:
            device.last_connection = datetime.now()
            # Si estaba NEW o UNPAIRED y se conecta, quizás cambia a ACTIVE?
            # (Solo si está paired, pero eso es lógica de negocio más compleja. Por ahora solo timestamp)
            if device.status == DeviceStatus.PAIRED:
                device.status = DeviceStatus.ACTIVE

            self.session.add(device)
            await self.session.commit()

    async def update_broker_presence(self, serial: str, is_connected: bool) -> Device | None:
        normalized = DeviceService.normalize_serial(serial)
        statement = select(Device).where(Device.serial == normalized)
        result = await self.session.exec(statement)
        device = result.first()
        if not device:
            return None

        now = datetime.utcnow()
        device.broker_connected = is_connected
        device.broker_status_updated_at = now
        if is_connected:
            device.broker_connected_at = now
        else:
            device.broker_disconnected_at = now

        self.session.add(device)
        await self.session.commit()
        return device

    async def register_runtime_report(
        self,
        db_device: Device,
        *,
        mac_address: Optional[str] = None,
        firmware_version: Optional[str] = None,
        ip_address: Optional[str] = None,
        rssi: Optional[int] = None,
        wifi_ssid: Optional[str] = None,
        last_reset_reason: Optional[str] = None,
        gps_latitude: Optional[float] = None,
        gps_longitude: Optional[float] = None,
        gps_updated_at: Optional[datetime] = None,
        touch_last_connection: bool = True,
    ) -> None:
        now = datetime.utcnow()

        if mac_address:
            db_device.mac_address = mac_address

        if firmware_version:
            db_device.firmware_version = firmware_version
        if ip_address:
            db_device.ip_address = ip_address
        if rssi is not None:
            db_device.rssi = rssi
        if wifi_ssid:
            db_device.wifi_ssid = wifi_ssid
        if last_reset_reason:
            db_device.last_reset_reason = last_reset_reason

        if gps_latitude is not None and gps_longitude is not None:
            db_device.gps_latitude = gps_latitude
            db_device.gps_longitude = gps_longitude
            db_device.gps_updated_at = gps_updated_at or now
            self.session.add(
                DeviceLocationReport(
                    device_id=db_device.id,
                    latitude=gps_latitude,
                    longitude=gps_longitude,
                    reported_at=gps_updated_at or now,
                )
            )

        if touch_last_connection:
            db_device.last_connection = now
            if db_device.status == DeviceStatus.PAIRED:
                db_device.status = DeviceStatus.ACTIVE

        self.session.add(db_device)
        await self.session.commit()
