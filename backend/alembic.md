## Inicializamos alembic con el siguiente comando:

```bash
alembic init alembic
```

## Modificamos el archivo alembic.ini

```ini
# Comentamos esta linea porque la configuracion de la base de datos se hace en:
# el archivo env.py y en el archivo de variables de entorno.env

# sqlalchemy.url = driver://user:pass@localhost/dbname
```

## Modificamos el archivo env.py

```python
# Importamos las librerias de os y dotenv
import os
from dotenv import load_dotenv

# importamos create_engine de sqlalchemy
from sqlalchemy import create_engine, engine_from_config

# Importamos SQLModel
from sqlmodel import SQLModel

# Importamos los modelos
from app.api.auth.model import User
from app.api.person.model import Person

# Cargamos las variables de entorno
load_dotenv()

# Obtenemos la URL de la base de datos
DATABASE_URL = os.getenv("DATABASE_URL")

# Obtenemos el metadata de la base de datos
target_metadata = SQLModel.metadata

# Modificamos las funciones:

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
```

## Generamos la primera migración

```bash
alembic revision --autogenerate -m "migracion inicial"
```

## Aplicamos la migración

```bash
alembic upgrade head
```

## Actualizaciones en los modelos de datos

Se pueden realizar actualizaciones en los modelos de datos.
Lo cual, se debe realizar de la siguiente manera:

### Generamos una nueva migración

```bash
alembic revision --autogenerate -m "actualizacion de modelos"
```

### Aplicamos la nueva migración

```bash
alembic upgrade head
```

## Revertir una migración

Se puede revertir una migración de la siguiente manera:

```bash
alembic downgrade -1 # Revierte la ultima migracion
```

```bash
alembic downgrade 0 # Revierte todas las migraciones
```

```bash
alembic downgrade 2 # Revierte las ultimas 2 migraciones
```
