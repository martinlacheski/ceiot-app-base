"""PulseScope resolution through a NOBYPASSRLS role: owners/guests only see their devices."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.auth.models import User
from app.api.live.service import DbPulseScopeResolver
from app.core.security import create_access_token
from test_device_history_environment_snapshot import history_rows  # noqa: F401

pytestmark = pytest.mark.asyncio


def _token(user_id):
    token, _ = create_access_token({"id": str(user_id)})
    return token


async def test_owner_guest_stranger_and_admin_scopes(postgres_rls_config, rls_engine_factory, history_rows):
    admin_engine = create_async_engine(postgres_rls_config.admin_url)
    suffix = uuid.uuid4().hex[:8]
    guest = User(email=f"pulse-guest-{suffix}@example.com", username=f"pulse-guest-{suffix}", password="x")
    stranger = User(email=f"pulse-stranger-{suffix}@example.com", username=f"pulse-stranger-{suffix}", password="x")
    relation = None
    administrator = User(email=f"pulse-admin-{suffix}@example.com", username=f"pulse-admin-{suffix}",
                         password="x", is_admin=True)
    try:
        async with AsyncSession(admin_engine, expire_on_commit=False) as setup:
            setup.add_all([guest, stranger, administrator])
            await setup.flush()
            relation = ScopedGuestRelation(
                owner_user_id=history_rows.old_owner_id, guest_user_id=guest.id,
                scope_type=ScopeType.ENVIRONMENT, scope_id=history_rows.old_environment_id,
                access_starts_at=datetime.now(timezone.utc) - timedelta(days=1))
            setup.add(relation)
            await setup.commit()

        resolver = DbPulseScopeResolver(rls_engine_factory())

        owner_scope = await resolver.authenticate(_token(history_rows.old_owner_id))
        assert history_rows.device_id in owner_scope.device_ids
        assert not owner_scope.is_admin
        assert owner_scope.expires_at is not None

        guest_scope = await resolver.authenticate(_token(guest.id))
        assert history_rows.device_id in guest_scope.device_ids

        stranger_scope = await resolver.authenticate(_token(stranger.id))
        assert stranger_scope.device_ids == frozenset()

        admin_scope = await resolver.authenticate(_token(administrator.id))
        assert admin_scope.is_admin

        # refresh re-reads access: the stranger still has nothing.
        assert (await resolver.refresh(stranger_scope)).device_ids == frozenset()
    finally:
        # Leave the shared fixture rows deletable (the relation references the owner).
        async with AsyncSession(admin_engine) as cleanup:
            if relation is not None:
                await cleanup.delete(relation)
            await cleanup.commit()
        await admin_engine.dispose()
