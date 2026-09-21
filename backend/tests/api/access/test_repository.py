from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.api.access.models import ScopeType, ScopedGuestRelation
from app.api.access.repository import GuestAccessRepository
from app.api.auth.models import User
from app.api.device.models import Device, DeviceStatus
from app.api.environment.environment.models import Environment, EnvironmentUser
from app.api.environment.environment_type.models import EnvironmentType
from app.api.location.models import LocationCity, LocationCountry, LocationState


def seed_scope_graph(session):
    country = LocationCountry(name="AR")
    session.add(country)
    session.commit()
    session.refresh(country)

    state = LocationState(name="BA", country_id=country.id)
    session.add(state)
    session.commit()
    session.refresh(state)

    city = LocationCity(name="La Plata", postal_code="1900", state_id=state.id)
    session.add(city)
    session.commit()
    session.refresh(city)

    env_type = EnvironmentType(name="Store")
    session.add(env_type)
    session.commit()
    session.refresh(env_type)

    owner = User(email="owner-access@example.com", username="owner_access", password="x")
    guest_env = User(email="guest-env@example.com", username="guest_env", password="x")
    guest_device = User(email="guest-device@example.com", username="guest_device", password="x")
    session.add(owner)
    session.add(guest_env)
    session.add(guest_device)
    session.commit()
    session.refresh(owner)
    session.refresh(guest_env)
    session.refresh(guest_device)

    environment = Environment(
        name="Env Access",
        address="Street 123",
        location="Hall",
        description="Env",
        city_id=city.id,
        type_id=env_type.id,
    )
    session.add(environment)
    session.commit()
    session.refresh(environment)

    owner_link = EnvironmentUser(
        environment_id=environment.id,
        user_id=owner.id,
        is_owner=True,
        is_active=True,
    )
    session.add(owner_link)
    session.commit()

    device = Device(
        serial="IOT-AAAA-0001",
        name="Device Access",
        status=DeviceStatus.PAIRED,
        environment_id=environment.id,
    )
    session.add(device)
    session.commit()
    session.refresh(device)

    return {
        "owner": owner,
        "guest_env": guest_env,
        "guest_device": guest_device,
        "environment": environment,
        "device": device,
    }


@pytest.mark.asyncio
async def test_repository_lists_environment_and_device_guests_as_additive_merge(
    session, async_session
):
    seed = seed_scope_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest_env"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1000"),
        )
    )
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest_device"].id,
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            commission_rate=Decimal("0.2500"),
        )
    )
    session.commit()

    repository = GuestAccessRepository(async_session)

    environment_relations = await repository.list_guest_relations(
        ScopeType.ENVIRONMENT, seed["environment"].id
    )
    device_relations = await repository.list_guest_relations(
        ScopeType.DEVICE, seed["device"].id
    )

    assert len(environment_relations) == 1
    assert len(device_relations) == 1
    assert environment_relations[0].guest_user_id == seed["guest_env"].id
    assert device_relations[0].guest_user_id == seed["guest_device"].id


@pytest.mark.asyncio
async def test_repository_returns_device_override_for_same_guest(
    session, async_session
):
    seed = seed_scope_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest_env"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1000"),
        )
    )
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest_env"].id,
            scope_type=ScopeType.DEVICE,
            scope_id=seed["device"].id,
            commission_rate=Decimal("0.1800"),
        )
    )
    session.commit()

    repository = GuestAccessRepository(async_session)
    env_relation = await repository.get_guest_relation(
        ScopeType.ENVIRONMENT,
        seed["environment"].id,
        seed["guest_env"].id,
    )
    device_relation = await repository.get_guest_relation(
        ScopeType.DEVICE,
        seed["device"].id,
        seed["guest_env"].id,
    )

    assert env_relation is not None
    assert device_relation is not None
    assert env_relation.commission_rate == Decimal("0.1000")
    assert device_relation.commission_rate == Decimal("0.1800")



def test_repository_enforces_unique_active_guest_relation_per_scope(session):
    seed = seed_scope_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest_env"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1000"),
        )
    )
    session.commit()

    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest_env"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1500"),
        )
    )

    with pytest.raises(IntegrityError):
        session.commit()


def test_repository_allows_inactive_guest_relation_history_when_scope_matches(session):
    seed = seed_scope_graph(session)
    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest_env"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1000"),
            is_active=False,
        )
    )
    session.commit()

    session.add(
        ScopedGuestRelation(
            owner_user_id=seed["owner"].id,
            guest_user_id=seed["guest_env"].id,
            scope_type=ScopeType.ENVIRONMENT,
            scope_id=seed["environment"].id,
            commission_rate=Decimal("0.1500"),
        )
    )
    session.commit()

    relations = session.exec(select(ScopedGuestRelation)).all()
    assert len(relations) == 2


def test_commission_values_are_stored_on_environment_and_device(session):
    seed = seed_scope_graph(session)
    seed["environment"].dvem_commission_rate = Decimal("0.0500")
    seed["environment"].guest_commission_rate = Decimal("0.3000")
    seed["device"].dvem_commission_rate = Decimal("0.0800")
    seed["device"].guest_commission_rate = Decimal("0.2500")
    session.add(seed["environment"])
    session.add(seed["device"])
    session.commit()

    assert seed["environment"].dvem_commission_rate == Decimal("0.0500")
    assert seed["environment"].guest_commission_rate == Decimal("0.3000")
    assert seed["device"].dvem_commission_rate == Decimal("0.0800")
    assert seed["device"].guest_commission_rate == Decimal("0.2500")
