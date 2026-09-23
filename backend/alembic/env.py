# Importamos las librerias de os y dotenv
import os
from dotenv import load_dotenv

from logging.config import fileConfig

# importamos create_engine de sqlalchemy
from sqlalchemy import create_engine, engine_from_config
from sqlalchemy import pool

from alembic import context


# Importamos SQLModel
from sqlmodel import SQLModel

# Import every table retained by the IoT baseline so Alembic sees the complete
# application metadata. These imports are intentionally explicit.
from app.api.auth.models import User  # noqa: F401
from app.api.location.models import LocationCountry, LocationState, LocationCity  # noqa: F401
from app.api.tax.identification_type.models import IdentificationType  # noqa: F401
from app.api.environment.environment.models import Environment, EnvironmentUser  # noqa: F401
from app.api.environment.environment_type.models import EnvironmentType  # noqa: F401
from app.api.environment.invitation.models import EnvironmentInvitation  # noqa: F401
from app.api.device.device_type.models import DeviceTypeCatalog  # noqa: F401
from app.api.device.models import Device, DeviceLocationReport  # noqa: F401
from app.api.device.operations.models import DeviceOperation  # noqa: F401
from app.api.sensor.models import SensorReading, Telemetry  # noqa: F401
from app.api.sensor_catalog.models import Variable, Sensor, SensorVariable, DeviceSensor  # noqa: F401
from app.api.access.models import (
    ScopedGuestRelation,
    ScopedGuestInvitation,
 )  # noqa: F401



# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
# target_metadata = None

# Cargamos las variables de entorno
load_dotenv()

# Obtenemos la URL de la base de datos
DATABASE_URL = os.getenv("ALEMBIC_DATABASE_URL")

# Alembic necesita drivers sincronos, no async
# Si la URL usa asyncpg (async), la convertimos a psycopg (sync)
if DATABASE_URL and "postgresql+asyncpg://" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace(
        "postgresql+asyncpg://", "postgresql+psycopg://")

# Obtenemos el metadata de la base de datos
target_metadata = SQLModel.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    # url = config.get_main_option("sqlalchemy.url")
    # Obtenemos la URL de la base de datos de las variables de entorno
    url = DATABASE_URL
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,  # Comparamos el tipo de datos
        compare_server_default=True,  # Comparamos el valor por defecto
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    # connectable = engine_from_config(
    #     config.get_section(config.config_ini_section, {}),
    #     prefix="sqlalchemy.",
    #     poolclass=pool.NullPool,
    # )

    # Creamos el engine de la base de datos
    connectable = create_engine(
        DATABASE_URL,
        poolclass=pool.NullPool,
        future=True,  # Usamos el futuro de SQLAlchemy
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata,
            compare_type=True,  # Comparamos el tipo de datos
            compare_server_default=True  # Comparamos el valor por defecto
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
