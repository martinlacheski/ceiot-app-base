"""Model side of normalization item 8 (migration 0022): no naive timestamp columns.

Every datetime column the models declare is ``timestamptz`` and reads back as an aware UTC
datetime, so the API serializes it with an explicit offset.
"""

from datetime import timedelta

from sqlalchemy import DateTime
from sqlmodel import Session, SQLModel, select

import app.main  # noqa: F401  (registers every table model)
from app.api.auth.models import User
from app.core.time import UTCDateTime


def _datetime_columns():
    for table in SQLModel.metadata.sorted_tables:
        for column in table.columns:
            column_type = column.type
            if isinstance(column_type, UTCDateTime):
                column_type = column_type.impl
            if isinstance(column_type, DateTime):
                yield table.name, column.name, column_type


def test_every_model_datetime_column_is_timezone_aware() -> None:
    naive = [f"{table}.{column}" for table, column, kind in _datetime_columns() if not kind.timezone]
    assert naive == []


def test_converted_columns_use_the_aware_utc_type() -> None:
    columns = {(table, column): kind for table, column, kind in _datetime_columns()}
    for key in (("user", "last_seen_at"), ("device_state", "last_connection"),
                ("scoped_guest_relation", "access_starts_at"), ("firmware_update", "download_expires_at")):
        assert key in columns, key
    assert isinstance(User.__table__.c["last_seen_at"].type, UTCDateTime)


def test_user_timestamps_read_back_aware(session: Session, test_user: User) -> None:
    session.expire_all()
    stored = session.exec(select(User).where(User.id == test_user.id)).one()
    assert stored.created_at.tzinfo is not None
    assert stored.created_at.utcoffset() == timedelta(0)


def test_user_default_created_at_is_aware_utc() -> None:
    value = User.model_fields["created_at"].default_factory()
    assert value.tzinfo is not None and value.utcoffset() == timedelta(0)
