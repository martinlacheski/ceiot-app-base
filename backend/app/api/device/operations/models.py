import uuid
from datetime import datetime
from enum import Enum
from typing import Optional
from sqlmodel import SQLModel, Field, func
from sqlalchemy import Column, DateTime

class DeviceOperationType(str, Enum):
    SENSOR_DATA = "SENSOR_DATA"
    KEEP_ACTIVE = "KEEP_ACTIVE"
    SESSION_REQUEST = "session_request"
    ERROR = "error"
    OTHER = "other"

class DeviceOperationStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    PENDING = "pending"

class DeviceOperation(SQLModel, table=True):
    # TimescaleDB prefers time as the partitioning column.
    # We use 'time' as the primary dimension.
    time: datetime = Field(
        sa_column=Column(
            DateTime(timezone=True),
            primary_key=True,
            server_default=func.now()
        )
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    
    # Operational identifier. Devices are resolved through their unique serial.
    device_serial: Optional[str] = Field(default=None) 
    
    operation_type: DeviceOperationType = Field(index=True)
    
    status: DeviceOperationStatus = Field(default=DeviceOperationStatus.PENDING)
    
