import uuid
from datetime import datetime
from enum import Enum
from typing import Optional
from sqlmodel import SQLModel, Field, func
from sqlalchemy import Column, DateTime, ForeignKey, Uuid

class DeviceOperationType(str, Enum):
    """Operation kinds. Values (the API contract) are lowercase snake_case.

    PostgreSQL stores member NAMES (SQLAlchemy's ``Enum`` default), so the values can
    change without touching stored rows. Parsing is case-insensitive so legacy
    clients sending ``SENSOR_DATA`` / ``KEEP_ACTIVE`` keep working.
    """

    SENSOR_DATA = "sensor_data"
    KEEP_ACTIVE = "keep_active"
    SESSION_REQUEST = "session_request"
    ERROR = "error"
    OTHER = "other"
    FIRMWARE_UPDATE = "firmware_update"
    # The device left an establishment (unpair / move to another one). Recorded in the
    # establishment being left, with the device name it had there (``device_name``).
    UNPAIR = "unpair"
    MOVE = "move"

    @classmethod
    def _missing_(cls, value):
        if isinstance(value, str):
            lowered = value.strip().lower()
            for member in cls:
                if member.value == lowered:
                    return member
        return None

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
    # FK to the device row; NULL for history whose device no longer exists or was never
    # registered. device_serial stays because former-owner history is read by serial.
    device_id: Optional[uuid.UUID] = Field(
        default=None,
        sa_column=Column(
            Uuid(),
            ForeignKey("device.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    environment_id: Optional[uuid.UUID] = Field(
        default=None,
        sa_column=Column(
            Uuid(),
            ForeignKey("environment.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    
    operation_type: DeviceOperationType = Field(index=True)

    # Name the device had in this row's establishment, snapshotted when it leaves it
    # (UNPAIR / MOVE). Former owners read it instead of the live device row, which they
    # can no longer see and whose later renames belong to the next owner.
    device_name: Optional[str] = Field(default=None, nullable=True)
    
    status: DeviceOperationStatus = Field(default=DeviceOperationStatus.PENDING)
    
