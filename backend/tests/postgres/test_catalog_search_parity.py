"""PostgreSQL coverage for list-search parity on users and admin catalogs."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.api.auth.models import User
from app.api.auth.repository import UserRepository
from app.api.environment.environment_type.models import EnvironmentType
from app.api.environment.environment_type.repository import EnvironmentTypeRepository
from app.api.location.models import LocationCity, LocationCountry, LocationState
from app.api.location.repository import LocationRepository
from app.api.tax.identification_type.models import IdentificationType
from app.api.tax.identification_type.repository import IdentificationTypeRepository


pytestmark = pytest.mark.asyncio

SCREENS = (
    "users",
    "countries",
    "states",
    "cities",
    "environment_types",
    "identification_types",
)


@dataclass(frozen=True)
class ScreenRows:
    visible_terms: tuple[tuple[str, uuid.UUID], ...]
    pagination_term: str
    literal_term: str
    literal_id: uuid.UUID
    missing_term: str


@dataclass(frozen=True)
class CatalogSearchRows:
    engine: AsyncEngine
    screens: dict[str, ScreenRows]
    user_ids: tuple[uuid.UUID, ...]
    city_ids: tuple[uuid.UUID, ...]
    state_ids: tuple[uuid.UUID, ...]
    country_ids: tuple[uuid.UUID, ...]
    environment_type_ids: tuple[uuid.UUID, ...]
    identification_type_ids: tuple[uuid.UUID, ...]


def _ids(page: dict) -> set[uuid.UUID]:
    return {item.id for item in page["items"]}


async def _search(
    session: AsyncSession,
    screen: str,
    term: str,
    *,
    page: int = 1,
    per_page: int = 100,
) -> dict:
    if screen == "users":
        return await UserRepository(session).get_all(
            page=page,
            per_page=per_page,
            is_active=None,
            is_admin=None,
            search=term,
        )

    locations = LocationRepository(session)
    if screen == "countries":
        return await locations.get_all_countries(
            page=page, per_page=per_page, is_active=None, search=term
        )
    if screen == "states":
        return await locations.get_all_states(
            page=page, per_page=per_page, is_active=None, search=term
        )
    if screen == "cities":
        return await locations.get_all_cities(
            page=page, per_page=per_page, is_active=None, search=term
        )
    if screen == "environment_types":
        return await EnvironmentTypeRepository(session).get_all(
            page=page, per_page=per_page, is_active=None, search=term
        )
    if screen == "identification_types":
        return await IdentificationTypeRepository(session).get_all(
            page=page, per_page=per_page, is_active=None, search=term
        )
    raise AssertionError(f"Unknown screen: {screen}")


@pytest_asyncio.fixture
async def catalog_search_rows(postgres_rls_config) -> AsyncIterator[CatalogSearchRows]:
    engine = create_async_engine(postgres_rls_config.admin_url, pool_pre_ping=True)
    suffix = uuid.uuid4().hex[:12]

    country_page = f"CountryPage{suffix}"
    countries = (
        LocationCountry(name=f"CountryNeedle{suffix} {country_page}"),
        LocationCountry(name=f"CountryBackup{suffix} {country_page}", is_active=False),
        LocationCountry(name=f"Country 100%_Literal{suffix}"),
        LocationCountry(name=f"Country 100XXLiteral{suffix}"),
    )

    state_page = f"StatePage{suffix}"
    states = (
        LocationState(
            name=f"StateNeedle{suffix} {state_page}", country_id=countries[0].id
        ),
        LocationState(
            name=f"StateBackup{suffix} {state_page}",
            country_id=countries[0].id,
            is_active=False,
        ),
        LocationState(
            name=f"State 100%_Literal{suffix}", country_id=countries[0].id
        ),
        LocationState(
            name=f"State 100XXLiteral{suffix}", country_id=countries[0].id
        ),
    )

    city_page = f"CityPage{suffix}"
    cities = (
        LocationCity(
            name=f"CityNeedle{suffix} {city_page}",
            postal_code=f"PostalNeedle{suffix}",
            state_id=states[0].id,
        ),
        LocationCity(
            name=f"CityBackup{suffix} {city_page}",
            postal_code=f"PostalBackup{suffix}",
            state_id=states[0].id,
            is_active=False,
        ),
        LocationCity(
            name=f"City 100%_Literal{suffix}",
            postal_code=f"SpecialPostal{suffix}",
            state_id=states[0].id,
        ),
        LocationCity(
            name=f"City 100XXLiteral{suffix}",
            postal_code=f"DecoyPostal{suffix}",
            state_id=states[0].id,
        ),
    )

    environment_page = f"EnvironmentTypePage{suffix}"
    environment_types = (
        EnvironmentType(name=f"EnvironmentNeedle{suffix} {environment_page}"),
        EnvironmentType(
            name=f"EnvironmentBackup{suffix} {environment_page}", is_active=False
        ),
        EnvironmentType(name=f"Environment 100%_Literal{suffix}"),
        EnvironmentType(name=f"Environment 100XXLiteral{suffix}"),
    )

    identification_page = f"IdentificationTypePage{suffix}"
    identification_types = (
        IdentificationType(name=f"IdentificationNeedle{suffix} {identification_page}"),
        IdentificationType(
            name=f"IdentificationBackup{suffix} {identification_page}", is_active=False
        ),
        IdentificationType(name=f"Identification 100%_Literal{suffix}"),
        IdentificationType(name=f"Identification 100XXLiteral{suffix}"),
    )

    user_page = f"UserPage{suffix}"
    users = (
        User(
            email=f"emailneedle{suffix}@example.com",
            username=f"userneedle{suffix}",
            password="not-used-by-this-test",
            first_name=f"FirstNeedle{suffix}",
            last_name=f"LastNeedle{suffix}",
            identification_number=f"DniNeedle{suffix}-{user_page}",
            is_active=True,
            is_admin=True,
        ),
        User(
            email=f"regular{suffix}@example.com",
            username=f"regular{suffix}",
            password="not-used-by-this-test",
            identification_number=f"RegularDni{suffix}-{user_page}",
            is_active=False,
            is_admin=False,
        ),
        User(
            email=f"special{suffix}@example.com",
            username=f"special{suffix}",
            password="not-used-by-this-test",
            first_name=f"User 100%_Literal{suffix}",
        ),
        User(
            email=f"decoy{suffix}@example.com",
            username=f"decoy{suffix}",
            password="not-used-by-this-test",
            first_name=f"User 100XXLiteral{suffix}",
        ),
    )

    async with AsyncSession(engine, expire_on_commit=False) as session:
        session.add_all(countries)
        await session.flush()
        session.add_all(states)
        await session.flush()
        session.add_all(cities)
        session.add_all(environment_types)
        session.add_all(identification_types)
        session.add_all(users)
        await session.commit()

    rows = CatalogSearchRows(
        engine=engine,
        screens={
            "users": ScreenRows(
                visible_terms=(
                    (f"UsErNeEdLe{suffix}", users[0].id),
                    (f"EmAiLnEeDlE{suffix}", users[0].id),
                    (f"FiRsTnEeDlE{suffix}", users[0].id),
                    (f"LaStNeEdLe{suffix}", users[0].id),
                    (f"DnInEeDlE{suffix}", users[0].id),
                    ("AcTiVo", users[0].id),
                    ("iNaC", users[1].id),
                    ("aDm", users[0].id),
                    ("uSu", users[1].id),
                ),
                pagination_term=user_page,
                literal_term=f"%_Literal{suffix}",
                literal_id=users[2].id,
                missing_term=f"MissingUser{suffix}",
            ),
            "countries": ScreenRows(
                visible_terms=(
                    (f"CoUnTrYnEeDlE{suffix}", countries[0].id),
                    ("AcTiVo", countries[0].id),
                    ("iNaC", countries[1].id),
                ),
                pagination_term=country_page,
                literal_term=f"%_Literal{suffix}",
                literal_id=countries[2].id,
                missing_term=f"MissingCountry{suffix}",
            ),
            "states": ScreenRows(
                visible_terms=(
                    (f"StAtEnEeDlE{suffix}", states[0].id),
                    (f"CoUnTrYnEeDlE{suffix}", states[0].id),
                    ("AcTiVo", states[0].id),
                    ("iNaC", states[1].id),
                ),
                pagination_term=state_page,
                literal_term=f"%_Literal{suffix}",
                literal_id=states[2].id,
                missing_term=f"MissingState{suffix}",
            ),
            "cities": ScreenRows(
                visible_terms=(
                    (f"CiTyNeEdLe{suffix}", cities[0].id),
                    (f"StAtEnEeDlE{suffix}", cities[0].id),
                    (f"CoUnTrYnEeDlE{suffix}", cities[0].id),
                    (f"PoStAlNeEdLe{suffix}", cities[0].id),
                    ("AcTiVo", cities[0].id),
                    ("iNaC", cities[1].id),
                ),
                pagination_term=city_page,
                literal_term=f"%_Literal{suffix}",
                literal_id=cities[2].id,
                missing_term=f"MissingCity{suffix}",
            ),
            "environment_types": ScreenRows(
                visible_terms=(
                    (f"EnViRoNmEnTnEeDlE{suffix}", environment_types[0].id),
                    ("AcTiVo", environment_types[0].id),
                    ("iNaC", environment_types[1].id),
                ),
                pagination_term=environment_page,
                literal_term=f"%_Literal{suffix}",
                literal_id=environment_types[2].id,
                missing_term=f"MissingEnvironmentType{suffix}",
            ),
            "identification_types": ScreenRows(
                visible_terms=(
                    (f"IdEnTiFiCaTiOnNeEdLe{suffix}", identification_types[0].id),
                    ("AcTiVo", identification_types[0].id),
                    ("iNaC", identification_types[1].id),
                ),
                pagination_term=identification_page,
                literal_term=f"%_Literal{suffix}",
                literal_id=identification_types[2].id,
                missing_term=f"MissingIdentificationType{suffix}",
            ),
        },
        user_ids=tuple(user.id for user in users),
        city_ids=tuple(city.id for city in cities),
        state_ids=tuple(state.id for state in states),
        country_ids=tuple(country.id for country in countries),
        environment_type_ids=tuple(item.id for item in environment_types),
        identification_type_ids=tuple(item.id for item in identification_types),
    )

    try:
        yield rows
    finally:
        async with AsyncSession(engine) as session:
            await session.exec(delete(User).where(User.id.in_(rows.user_ids)))
            await session.exec(delete(LocationCity).where(LocationCity.id.in_(rows.city_ids)))
            await session.exec(delete(LocationState).where(LocationState.id.in_(rows.state_ids)))
            await session.exec(
                delete(LocationCountry).where(LocationCountry.id.in_(rows.country_ids))
            )
            await session.exec(
                delete(EnvironmentType).where(
                    EnvironmentType.id.in_(rows.environment_type_ids)
                )
            )
            await session.exec(
                delete(IdentificationType).where(
                    IdentificationType.id.in_(rows.identification_type_ids)
                )
            )
            await session.commit()
        await engine.dispose()


@pytest.mark.parametrize("screen", SCREENS)
async def test_search_matches_every_visible_column_case_insensitively(
    catalog_search_rows: CatalogSearchRows,
    screen: str,
) -> None:
    expected = catalog_search_rows.screens[screen]
    async with AsyncSession(catalog_search_rows.engine, expire_on_commit=False) as session:
        for term, expected_id in expected.visible_terms:
            result = await _search(session, screen, term)
            assert expected_id in _ids(result), (screen, term)


@pytest.mark.parametrize("screen", SCREENS)
async def test_search_no_match_returns_empty(
    catalog_search_rows: CatalogSearchRows,
    screen: str,
) -> None:
    expected = catalog_search_rows.screens[screen]
    async with AsyncSession(catalog_search_rows.engine, expire_on_commit=False) as session:
        result = await _search(session, screen, expected.missing_term)

    assert result["items"] == []
    assert result["total"] == 0


@pytest.mark.parametrize("screen", SCREENS)
async def test_search_combines_with_pagination(
    catalog_search_rows: CatalogSearchRows,
    screen: str,
) -> None:
    expected = catalog_search_rows.screens[screen]
    async with AsyncSession(catalog_search_rows.engine, expire_on_commit=False) as session:
        result = await _search(
            session,
            screen,
            expected.pagination_term,
            page=2,
            per_page=1,
        )

    assert result["total"] == 2
    assert result["pages"] == 2
    assert result["page"] == 2
    assert len(result["items"]) == 1


@pytest.mark.parametrize("screen", SCREENS)
async def test_search_treats_like_metacharacters_literally(
    catalog_search_rows: CatalogSearchRows,
    screen: str,
) -> None:
    expected = catalog_search_rows.screens[screen]
    async with AsyncSession(catalog_search_rows.engine, expire_on_commit=False) as session:
        result = await _search(session, screen, expected.literal_term)

    assert _ids(result) == {expected.literal_id}
