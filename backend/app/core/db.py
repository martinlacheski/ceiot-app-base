import collections.abc
import contextlib

from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    create_async_engine,
)
from sqlmodel import Session, create_engine
from sqlmodel.ext.asyncio.session import (
    AsyncSession,
)

from app.core.config import settings


def _reset_rls_identity(
    dbapi_connection,
    connection_record,
    reset_state,
) -> None:
    """Clear session-scoped RLS identity before a connection is pooled again."""
    del connection_record
    if reset_state.terminate_only:
        return

    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("RESET app.current_user_id")
        # RESET is transactional in PostgreSQL.  The pool's normal reset-on-return
        # rollback runs after this event, so the reset must be committed first.
        cursor.execute("COMMIT")
    finally:
        cursor.close()


def install_rls_identity_reset(engine: Engine | AsyncEngine) -> None:
    """Install PostgreSQL pool cleanup on a sync or async SQLAlchemy engine."""
    sync_engine = engine.sync_engine if isinstance(engine, AsyncEngine) else engine
    if sync_engine.dialect.name != "postgresql":
        return
    if not event.contains(sync_engine, "reset", _reset_rls_identity):
        event.listen(sync_engine, "reset", _reset_rls_identity)


# Se crea el engine de la base de datos (sincrónico)
# Para PostgreSQL con asyncpg, necesitamos convertir a psycopg para operaciones sincrónicas
sync_database_url = settings.DATABASE_URL
if "postgresql+asyncpg://" in sync_database_url:
    sync_database_url = sync_database_url.replace(
        "postgresql+asyncpg://", "postgresql+psycopg://"
    )

engine = create_engine(
    sync_database_url,
    echo=False,
    connect_args=(
        {"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
    ),
)

# Async Engine - psycopg3 soporta async nativo; solo convertir sqlite
async_database_url = settings.DATABASE_URL
if "sqlite://" in async_database_url:
    async_database_url = async_database_url.replace(
        "sqlite://", "sqlite+aiosqlite://"
    )

async_engine = create_async_engine(
    async_database_url,
    echo=False,
    connect_args=(
        {"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
    ),
)

install_rls_identity_reset(engine)
install_rls_identity_reset(async_engine)


def get_session() -> collections.abc.Iterator[Session]:
    """Devuelve una sesión de la base de datos gestionada como un contexto"""
    with Session(engine) as session:
        yield session


async def get_async_session() -> collections.abc.AsyncGenerator[AsyncSession, None]:
    async with AsyncSession(async_engine, expire_on_commit=False) as session:
        yield session


@contextlib.asynccontextmanager
async def system_session() -> collections.abc.AsyncGenerator[AsyncSession, None]:
    """Sesión con bypass RLS system_mqtt usando conexión explícita.

    Usa engine.connect() para que SET SESSION persista a través de múltiples
    commits intermedios (SQLAlchemy 2.0 devuelve la conexión al pool en cada commit).

    IMPORTANTE: set_config se ejecuta a través de la sesión (no del conn raw) para
    evitar el comportamiento "conditional_savepoint" de SQLAlchemy 2.0, que usa
    SAVEPOINTs en vez de COMMITs reales cuando la conexión ya tiene una transacción
    activa al momento de crear la AsyncSession.
    """
    async with (
        async_engine.connect() as conn,
        AsyncSession(conn, expire_on_commit=False) as session,
    ):
        await session.execute(
            text(
                "SELECT set_config('app.current_user_id', "
                "'system_mqtt', false)"
            )
        )
        yield session
