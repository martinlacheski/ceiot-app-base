"""The schema prompt is built under the asking user's identity: no cross-tenant hints."""

import pytest

from app.api.assistant import sql_schema
from test_ai_read_views import world  # noqa: F401  (shared fixture)

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _fresh_cache():
    sql_schema.clear_cache()
    yield
    sql_schema.clear_cache()


async def test_each_user_prompt_lists_only_their_own_devices_and_environments(rls_engine_factory, world):  # noqa: F811
    engine = rls_engine_factory()
    mine = await sql_schema.schema_prompt(engine, world.owner_a)
    theirs = await sql_schema.schema_prompt(engine, world.owner_b)
    assert mine.source == theirs.source == "database"
    assert world.device_a in mine.text and world.env_a in mine.text and world.device_b not in mine.text
    assert world.device_b in theirs.text and world.device_a not in theirs.text and world.env_a not in theirs.text
    # Catalog facts every user may know.
    for prompt in (mine, theirs):
        assert "temperature (Temperatura, unidad °C)" in prompt.text and "dht22 (DHT22)" in prompt.text


async def test_stranger_prompt_has_catalog_but_no_tenant_data_and_admin_sees_all(rls_engine_factory, world):  # noqa: F811
    engine = rls_engine_factory()
    stranger = await sql_schema.schema_prompt(engine, world.stranger)
    assert world.device_a not in stranger.text and world.device_b not in stranger.text
    assert "ai_read.telemetry(" in stranger.text and "relative_humidity" in stranger.text
    admin = await sql_schema.schema_prompt(engine, world.admin)
    assert world.device_a in admin.text and world.device_b in admin.text
