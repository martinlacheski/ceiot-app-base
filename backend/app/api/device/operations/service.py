from typing import Optional, Dict
from datetime import datetime
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.device.operations.models import (
    DeviceOperation,
    DeviceOperationType,
    DeviceOperationStatus,
)


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
    ) -> dict:
        from sqlmodel import select, func, desc
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

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar_one()

        # Pagination & Ordering
        query = query.order_by(desc(DeviceOperation.time))
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
