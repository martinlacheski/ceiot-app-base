
import pytest
from unittest.mock import MagicMock, AsyncMock
from sqlmodel import select
from app.services.pagination import DEFAULT_PER_PAGE, paginate_query_async, sanitize_pagination
from app.api.auth.models import User

# Mock DB Session


@pytest.fixture
def mock_db_session():
    session = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_paginate_query_async_total_filtered(mock_db_session):
    # Setup
    # We want to simulate a scenario where we have a filtered query
    # and we want to ensure the 'total' is calculated based on that filter, not the whole table.

    # Mock the return value of scalar() which is used for counting
    # The code calls db.scalar(count_query)
    # We want to assert that it called scalar with a query derived from base_query

    mock_db_session.scalar.return_value = 5  # Assume 5 items match the filter

    # Mock the exec() result for items
    mock_result = MagicMock()
    mock_result.all.return_value = ["item1", "item2"]  # 2 items on this page
    mock_db_session.exec.return_value = mock_result

    # Create a dummy base_query
    # In real usage this is a Select object.
    # We just need it to be not None so the 'if base_query is not None' block is entered.
    base_query = select(User).where(User.username == "filtered")

    result = await paginate_query_async(
        db=mock_db_session,
        model=User,
        base_query=base_query,
        page=1,
        per_page=10
    )

    # Assertions
    assert result["total"] == 5
    assert result["items"] == ["item1", "item2"]

    # Verify that scalar was called (it means count query was executed)
    assert mock_db_session.scalar.called


def test_sanitize_pagination_allows_export_sized_pages():
    assert sanitize_pagination(1, 10000) == (1, 10000)


def test_sanitize_pagination_clamps_above_cap():
    assert sanitize_pagination(1, 10001) == (1, 10000)


def test_sanitize_pagination_lower_bounds():
    # 0/None fall back to the default page size; negatives clamp to 1.
    assert sanitize_pagination(0, 0) == (1, DEFAULT_PER_PAGE)
    assert sanitize_pagination(None, None) == (1, DEFAULT_PER_PAGE)
    assert sanitize_pagination(-3, -5) == (1, 1)
