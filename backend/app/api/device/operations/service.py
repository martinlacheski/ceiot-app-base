from typing import Dict, Literal, Optional
from datetime import datetime
from uuid import UUID
from sqlalchemy import String, cast, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from app.api.device.operations.models import (
    DeviceOperation,
    DeviceOperationType,
    DeviceOperationStatus,
)
from app.core.search import ILIKE_ESCAPE, formatted_datetime, ilike_pattern


class DeviceOperationService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_device(
        self,
        device_id: UUID,
        page: int = 1,
        per_page: int = 20,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        operation_type: Optional[DeviceOperationType] = None,
        access_starts_at: Optional[datetime] = None,
        search: Optional[str] = None,
        sort_by: Literal["time", "id", "operation_type", "status"] = "time",
        sort_order: Literal["asc", "desc"] = "desc",
        utc_offset_minutes: int = 0,
    ) -> dict:
        from app.api.device.models import Device

        device_result = await self.session.execute(
            select(Device.serial).where(Device.id == device_id)
        )
        device_serial = device_result.scalar_one_or_none()
        if not device_serial:
            return {
                "items": [],
                "total": 0,
                "page": page,
                "per_page": per_page,
                "pages": 0,
            }

        query = select(DeviceOperation).where(DeviceOperation.device_serial == device_serial)

        # Filters
        if access_starts_at:
            query = query.where(DeviceOperation.time >= access_starts_at)

        if start_date:
            query = query.where(DeviceOperation.time >= start_date)

        if end_date:
            query = query.where(DeviceOperation.time <= end_date)

        if operation_type:
            query = query.where(DeviceOperation.operation_type == operation_type)

        search_pattern = ilike_pattern(search)
        if search_pattern is not None:
            displayed_time = formatted_datetime(
                DeviceOperation.time,
                utc_offset_minutes,
                timezone_aware=True,
            )
            query = query.where(
                or_(
                    *(
                        expression.ilike(
                            search_pattern,
                            escape=ILIKE_ESCAPE,
                        )
                        for expression in (
                            displayed_time,
                            cast(DeviceOperation.id, String),
                            cast(DeviceOperation.operation_type, String),
                            cast(DeviceOperation.status, String),
                        )
                    )
                )
            )

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar_one()

        # Pagination & Ordering
        sort_expressions = {
            "time": DeviceOperation.time,
            "id": DeviceOperation.id,
            # Postgres orders native enums by declaration order; sort by the
            # label text so the order matches what the table shows.
            "operation_type": cast(DeviceOperation.operation_type, String),
            "status": cast(DeviceOperation.status, String),
        }
        sort_expression = sort_expressions[sort_by]
        ordered_expression = (
            sort_expression.desc() if sort_order == "desc" else sort_expression.asc()
        )
        query = query.order_by(
            ordered_expression,
            DeviceOperation.time.desc(),
            DeviceOperation.id.asc(),
        )
        query = query.offset((page - 1) * per_page).limit(per_page)

        result = await self.session.execute(query)
        operations = result.scalars().all()

        items = []
        for op in operations:
            op_dict = {
                "time": op.time,
                "id": str(op.id),
                "device_serial": op.device_serial,
                "operation_type": op.operation_type,
                "status": op.status,
            }
            items.append(op_dict)

        return {
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "pages": (total + per_page - 1) // per_page,
        }

    async def create_operation(
        self,
        operation_type: DeviceOperationType,
        device_id: Optional[UUID] = None,
        device_serial: Optional[str] = None,
        payload: Optional[Dict] = None,
        response: Optional[Dict] = None,
        status: DeviceOperationStatus = DeviceOperationStatus.PENDING,
    ) -> DeviceOperation:
        operation = DeviceOperation(
            operation_type=operation_type,
            device_serial=device_serial,
            status=status,
            # time is auto-set by DB default (now()) or we can pass it if event time is known
        )
        self.session.add(operation)
        await self.session.commit()

        return operation
