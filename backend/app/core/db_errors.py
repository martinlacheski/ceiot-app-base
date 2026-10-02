"""Translate database uniqueness violations into HTTP 409 answers."""
from contextlib import asynccontextmanager

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError


@asynccontextmanager
async def conflict_on_duplicate(session, message: str):
    """Run a write; a unique-constraint race the pre-checks missed becomes a 409.

    The pre-checks in the services give the friendly path; the database constraint is the
    authority, so concurrent requests and paths without a pre-check still answer 409
    instead of a 500.
    """
    try:
        yield
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message) from error
