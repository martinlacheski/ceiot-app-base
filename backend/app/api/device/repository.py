from typing import Optional, Dict, Any, List, Literal
import uuid
from datetime import date, datetime
from sqlalchemy import String, and_, case, cast, false, func, literal, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload
from sqlmodel import select
from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.auth.models import User
from app.api.device.device_type.models import DeviceTypeCatalog
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
from app.core.search import (
    ILIKE_ESCAPE,
    formatted_date,
    formatted_datetime,
    ilike_pattern,
)


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
        connected_serials: frozenset[str] | None = None,
        utc_offset_minutes: int = 0,
        owner_search_environment_ids: Optional[list[uuid.UUID]] = None,
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

        search_pattern = ilike_pattern(search)
        if search_pattern is not None:
            query = query.outerjoin(
                DeviceTypeCatalog,
                DeviceTypeCatalog.id == Device.device_type_id,
            ).outerjoin(
                Environment,
                Environment.id == Device.environment_id,
            )
            SearchOwnerMembership = aliased(EnvironmentUser)
            SearchOwner = aliased(User)
            owner_full_name = func.trim(
                SearchOwner.first_name + " " + SearchOwner.last_name
            )
            owner_matches = (
                select(SearchOwnerMembership.id)
                .join(
                    SearchOwner,
                    SearchOwner.id == SearchOwnerMembership.user_id,
                )
                .where(
                    SearchOwnerMembership.environment_id == Device.environment_id,
                    SearchOwnerMembership.is_owner.is_(True),
                    SearchOwnerMembership.is_active.is_(True),
                    or_(
                        SearchOwner.first_name.ilike(
                            search_pattern,
                            escape=ILIKE_ESCAPE,
                        ),
                        SearchOwner.last_name.ilike(
                            search_pattern,
                            escape=ILIKE_ESCAPE,
                        ),
                        owner_full_name.ilike(
                            search_pattern,
                            escape=ILIKE_ESCAPE,
                        ),
                        and_(
                            func.nullif(owner_full_name, "").is_(None),
                            SearchOwner.username.ilike(
                                search_pattern,
                                escape=ILIKE_ESCAPE,
                            ),
                        ),
                    ),
                )
                .exists()
            )
            HasOwnerMembership = aliased(EnvironmentUser)
            has_active_owner = (
                select(HasOwnerMembership.id)
                .where(
                    HasOwnerMembership.environment_id == Device.environment_id,
                    HasOwnerMembership.is_owner.is_(True),
                    HasOwnerMembership.is_active.is_(True),
                )
                .exists()
            )
            if user_id is not None:
                ActorOwnerMembership = aliased(EnvironmentUser)
                actor_is_owner = (
                    select(ActorOwnerMembership.id)
                    .where(
                        ActorOwnerMembership.environment_id == Device.environment_id,
                        ActorOwnerMembership.user_id == user_id,
                        ActorOwnerMembership.is_owner.is_(True),
                        ActorOwnerMembership.is_active.is_(True),
                    )
                    .exists()
                )
            else:
                actor_is_owner = false()
            displayed_owner_fallback = case(
                (actor_is_owner, "Yo"),
                (
                    Device.environment_id.is_not(None) & ~has_active_owner,
                    "Desconocido",
                ),
                else_="",
            )
            effective_location = case(
                (
                    Device.gps_latitude.is_not(None)
                    & Device.gps_longitude.is_not(None),
                    cast(Device.gps_latitude, String)
                    + literal(",")
                    + cast(Device.gps_longitude, String),
                ),
                else_=Environment.location,
            )
            status_label = case(
                (Device.status == DeviceStatus.NEW, "NUEVO"),
                (Device.status == DeviceStatus.PAIRED, "VINCULADO"),
                (Device.status == DeviceStatus.ACTIVE, "ACTIVO"),
                (Device.status == DeviceStatus.MAINTENANCE, "MANTENIMIENTO"),
                (Device.status == DeviceStatus.UNPAIRED, "DESVINCULADO"),
            )
            enabled_label = case(
                (Device.enabled.is_(True), "Si"),
                else_="No",
            )
            enabled_state_label = case(
                (Device.enabled.is_(True), "Habilitado"),
                else_="Deshabilitado",
            )
            active_label = case(
                (Device.is_active.is_(True), "Activo"),
                else_="Inactivo",
            )
            if connected_serials is None:
                presence_label = literal("No disponible")
            elif connected_serials:
                presence_label = case(
                    (Device.serial.in_(sorted(connected_serials)), "Online"),
                    else_="Offline",
                )
            else:
                presence_label = literal("Offline")

            displayed_description = case(
                (
                    Device.description.is_(None)
                    | (func.trim(Device.description) == ""),
                    "Sin descripción",
                ),
                else_=Device.description,
            )
            displayed_last_connection = case(
                (Device.last_connection.is_(None), "Nunca"),
                else_=formatted_datetime(
                    Device.last_connection,
                    utc_offset_minutes,
                ),
            )
            mobile_last_connection = case(
                (Device.last_connection.is_(None), "Sin registros"),
                else_=formatted_datetime(
                    Device.last_connection,
                    utc_offset_minutes,
                ),
            )

            displayed_expressions = (
                Device.name,
                Device.serial,
                displayed_description,
                Device.model,
                Device.batch,
                DeviceTypeCatalog.name,
                Environment.name,
                displayed_owner_fallback,
                effective_location,
                formatted_date(Device.manufacture_date),
                displayed_last_connection,
                mobile_last_connection,
                status_label,
                enabled_label,
                enabled_state_label,
                active_label,
                presence_label,
            )
            search_conditions = [
                expression.ilike(
                    search_pattern,
                    escape=ILIKE_ESCAPE,
                )
                for expression in displayed_expressions
            ]
            search_conditions.append(owner_matches)
            if owner_search_environment_ids:
                search_conditions.append(
                    Device.environment_id.in_(owner_search_environment_ids)
                )
            query = query.where(or_(*search_conditions))

        if device_type_id is not None:
            query = query.where(Device.device_type_id == device_type_id)

        model_pattern = ilike_pattern(model)
        if model_pattern is not None:
            query = query.where(
                Device.model.ilike(model_pattern, escape=ILIKE_ESCAPE)
            )

        batch_pattern = ilike_pattern(batch)
        if batch_pattern is not None:
            query = query.where(
                Device.batch.ilike(batch_pattern, escape=ILIKE_ESCAPE)
            )

        if manufacture_date:
            # Assuming exact match for date string YYYY-MM-DD
            query = query.where(Device.manufacture_date == manufacture_date)

        if status:
            query = query.where(Device.status == status)

        if enabled is not None:
            query = query.where(Device.enabled == enabled)

        if owner_id:
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
        }
        if sort_by == "brokerConnected":
            if connected_serials is None:
                return await paginate_query_async(
                    self.session, Device, query.order_by(Device.id.asc()), page, per_page
                )
            sort_expression = (
                case(
                    (Device.serial.in_(sorted(connected_serials)), True),
                    else_=False,
                )
                if connected_serials
                else false()
            )
        else:
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
