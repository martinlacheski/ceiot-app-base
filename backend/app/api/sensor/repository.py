from sqlmodel.ext.asyncio.session import AsyncSession
import uuid

from sqlalchemy import and_, func, select
from app.api.sensor.models import SensorReading
from typing import Optional, List
from datetime import datetime, timedelta
from app.core.time import utc_now


class SensorRepository:
    def __init__(self, session: AsyncSession):
        self.session = session
    
    async def create(self, reading: SensorReading) -> SensorReading:
        """Crea una nueva lectura de sensor"""
        self.session.add(reading)
        await self.session.commit()
        return reading
    
    async def get_latest_by_device(
        self, 
        device_serial: str,
        limit: int = 10
    ) -> List[SensorReading]:
        """Obtiene las últimas lecturas de un dispositivo"""
        result = await self.session.execute(
            select(SensorReading)
            .where(SensorReading.device_serial == device_serial)
            .order_by(SensorReading.time.desc(), SensorReading.id.desc())
            .limit(limit)
        )
        return list(result.scalars().all())
    
    async def get_readings_in_range(
        self,
        device_serial: str,
        start_time: datetime,
        end_time: datetime
    ) -> List[SensorReading]:
        """Obtiene lecturas en un rango de tiempo"""
        result = await self.session.execute(
            select(SensorReading)
            .where(
                and_(
                    SensorReading.device_serial == device_serial,
                    SensorReading.time >= start_time,
                    SensorReading.time <= end_time
                )
            )
            .order_by(SensorReading.time.asc(), SensorReading.id.asc())
        )
        return list(result.scalars().all())
    
    async def get_recent_readings(
        self,
        device_serial: str,
        hours: int = 24
    ) -> List[SensorReading]:
        """Obtiene lecturas recientes (últimas N horas)"""
        start_time = utc_now() - timedelta(hours=hours)
        return await self.get_readings_in_range(
            device_serial,
            start_time,
            utc_now()
        )

    async def get_latest_by_device_id(
        self,
        device_id: uuid.UUID,
        limit: int = 10,
        start_time: Optional[datetime] = None,
    ) -> tuple[List[SensorReading], int]:
        """Return the newest authorized readings and the full matching count."""
        filters = [SensorReading.device_id == device_id]
        if start_time is not None:
            filters.append(SensorReading.time >= start_time)

        result = await self.session.execute(
            select(SensorReading)
            .where(*filters)
            .order_by(SensorReading.time.desc(), SensorReading.id.desc())
            .limit(limit)
        )
        total_result = await self.session.execute(
            select(func.count())
            .select_from(SensorReading)
            .where(*filters)
        )
        return list(result.scalars().all()), total_result.scalar_one()

    async def get_readings_by_device_id_and_range(
        self,
        device_id: uuid.UUID,
        start_time: datetime,
        end_time: datetime,
    ) -> List[SensorReading]:
        """Return one device's readings inside an inclusive time range."""
        result = await self.session.execute(
            select(SensorReading)
            .where(
                and_(
                    SensorReading.device_id == device_id,
                    SensorReading.time >= start_time,
                    SensorReading.time <= end_time,
                )
            )
            .order_by(SensorReading.time.asc(), SensorReading.id.asc())
        )
        return list(result.scalars().all())
