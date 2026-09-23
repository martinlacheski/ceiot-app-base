"""Add environmental sensor catalogs and snapshot-scoped JSONB telemetry.

Revision ID: 0005
Revises: 0004
"""

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

ENVIRONMENTAL_ID = uuid.UUID("6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c32")
RELAY_1_ID = uuid.UUID("6a8e2b8d-2f9d-4f8d-8b7b-5b8f8e4d2c31")

# Frozen migration seed. Runtime constants may evolve without rewriting history.
VARIABLE_IDS = {
    "temperature": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0001"),
    "relative_humidity": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0002"),
    "pressure": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0003"),
}
SENSOR_IDS = {
    "dht11": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0011"),
    "dht22": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0012"),
    "bmp280": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0013"),
    "bme280": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0014"),
}
VARIABLE_SEEDS = (
    ("temperature", "Temperatura", "°C", "Ambient temperature"),
    ("relative_humidity", "Humedad relativa", "%", "Relative humidity"),
    ("pressure", "Presión atmosférica", "hPa", "Atmospheric pressure"),
)
SENSOR_SEEDS = (
    ("dht11", "DHT11", "Aosong", "Digital temperature and humidity sensor"),
    ("dht22", "DHT22", "Aosong", "Digital temperature and humidity sensor"),
    ("bmp280", "BMP280", "Bosch", "Temperature and pressure sensor"),
    ("bme280", "BME280", "Bosch", "Temperature, humidity and pressure sensor"),
)
SENSOR_VARIABLE_SPECS = (
    ("dht11", "temperature", 0, 50, "±2 °C", "1 °C"),
    ("dht11", "relative_humidity", 20, 90, "±5 %", "1 %"),
    ("dht22", "temperature", -40, 80, "±0.5 °C", "0.1 °C"),
    ("dht22", "relative_humidity", 0, 100, "±2 %", "0.1 %"),
    ("bmp280", "temperature", -40, 85, "±1 °C", "0.01 °C"),
    ("bmp280", "pressure", 300, 1100, "±1 hPa", "0.01 hPa"),
    ("bme280", "temperature", -40, 85, "±1 °C", "0.01 °C"),
    ("bme280", "relative_humidity", 0, 100, "±3 %", "0.008 %"),
    ("bme280", "pressure", 300, 1100, "±1 hPa", "0.01 hPa"),
)


def _identity_fragments():
    uid = "current_setting('app.current_user_id', true)"
    system = f"{uid} = ANY (ARRAY['system_mqtt', 'system_admin'])"
    admin = f"EXISTS (SELECT 1 FROM public.\"user\" u WHERE u.id::text = {uid} AND u.is_admin AND u.is_active)"
    members = (
        "SELECT eu.environment_id FROM public.environmentuser eu "
        f"WHERE eu.user_id::text = {uid} AND {uid} <> '' AND eu.is_active = true"
    )
    owners = (
        "SELECT eu.environment_id FROM public.environmentuser eu "
        f"WHERE eu.user_id::text = {uid} AND {uid} <> '' AND eu.is_active = true AND eu.is_owner = true"
    )
    guests = (
        "SELECT sgr.scope_id FROM public.scoped_guest_relation sgr "
        f"WHERE sgr.scope_type = 'environment' AND sgr.guest_user_id::text = {uid} "
        f"AND sgr.is_active = true AND sgr.access_starts_at <= CURRENT_TIMESTAMP AND {uid} <> ''"
    )
    guest_devices = (
        "SELECT sgr.scope_id FROM public.scoped_guest_relation sgr "
        f"WHERE sgr.scope_type = 'device' AND sgr.guest_user_id::text = {uid} "
        f"AND sgr.is_active = true AND sgr.access_starts_at <= CURRENT_TIMESTAMP AND {uid} <> ''"
    )
    return uid, system, admin, members, owners, guests, guest_devices


def upgrade():
    for name, extra in (
        ("variable", [sa.Column("unit", sa.Text(), nullable=False)]),
        ("sensor", [sa.Column("manufacturer", sa.Text(), nullable=False)]),
    ):
        op.create_table("%s" % name,
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("code", sa.Text(), nullable=False, unique=True),
            sa.Column("name", sa.Text(), nullable=False),
            *extra,
            sa.Column("description", sa.Text()),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )

    op.create_table("sensor_variable",
        sa.Column("sensor_id", sa.Uuid(), sa.ForeignKey("sensor.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("variable_id", sa.Uuid(), sa.ForeignKey("variable.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("min_value", sa.Float(), nullable=False),
        sa.Column("max_value", sa.Float(), nullable=False),
        sa.Column("accuracy", sa.Text(), nullable=False),
        sa.Column("resolution", sa.Text(), nullable=False),
        sa.CheckConstraint("min_value <= max_value", name="ck_sensor_variable_range"),
    )
    op.create_table("device_sensor",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("device_id", sa.Uuid(), sa.ForeignKey("device.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sensor_id", sa.Uuid(), sa.ForeignKey("sensor.id"), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("config", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("installed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("removed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("device_id", "key", name="uq_device_sensor_device_key"),
        sa.CheckConstraint("key ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'", name="ck_device_sensor_key_slug"),
        sa.CheckConstraint("jsonb_typeof(config) = 'object'", name="ck_device_sensor_config_object"),
    )
    op.create_index("ix_device_sensor_device_id", "device_sensor", ["device_id"])
    op.create_index("ix_device_sensor_sensor_id", "device_sensor", ["sensor_id"])

    op.create_table("telemetry",
        sa.Column("time", sa.DateTime(timezone=True), primary_key=True, server_default=sa.func.now()),
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("device_id", sa.Uuid(), sa.ForeignKey("device.id")),
        sa.Column("device_serial", sa.Text(), nullable=False),
        sa.Column("environment_id", sa.Uuid(), sa.ForeignKey("environment.id", ondelete="SET NULL")),
        sa.Column("values", JSONB(), nullable=False),
        sa.CheckConstraint("jsonb_typeof(\"values\") = 'object'", name="ck_telemetry_values_object"),
    )
    op.execute("SELECT create_hypertable('telemetry', 'time', if_not_exists => TRUE, create_default_indexes => FALSE)")
    op.create_index("ix_telemetry_device_time", "telemetry", ["device_id", sa.text("time DESC")])
    op.create_index("ix_telemetry_values_gin", "telemetry", ["values"], postgresql_using="gin", postgresql_ops={"values": "jsonb_path_ops"})
    op.create_index("ix_telemetry_environment_id", "telemetry", ["environment_id"])

    op.execute("""
        CREATE FUNCTION public.set_telemetry_environment_id()
        RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp AS $$
        BEGIN
            IF NEW.environment_id IS NULL THEN
                SELECT d.environment_id INTO NEW.environment_id
                FROM public.device d
                WHERE (NEW.device_id IS NOT NULL AND d.id = NEW.device_id)
                   OR (NEW.device_id IS NULL AND d.serial = NEW.device_serial)
                LIMIT 1;
            END IF;
            RETURN NEW;
        END; $$
    """)
    op.execute("CREATE TRIGGER set_telemetry_environment_id BEFORE INSERT ON public.telemetry FOR EACH ROW EXECUTE FUNCTION public.set_telemetry_environment_id()")

    bind = op.get_bind()
    variable_table = sa.table("variable", sa.column("id", sa.Uuid()), sa.column("code", sa.Text()), sa.column("name", sa.Text()), sa.column("unit", sa.Text()), sa.column("description", sa.Text()))
    sensor_table = sa.table("sensor", sa.column("id", sa.Uuid()), sa.column("code", sa.Text()), sa.column("name", sa.Text()), sa.column("manufacturer", sa.Text()), sa.column("description", sa.Text()))
    capability_table = sa.table("sensor_variable", sa.column("sensor_id", sa.Uuid()), sa.column("variable_id", sa.Uuid()), sa.column("min_value", sa.Float()), sa.column("max_value", sa.Float()), sa.column("accuracy", sa.Text()), sa.column("resolution", sa.Text()))
    bind.execute(variable_table.insert(), [dict(id=VARIABLE_IDS[code], code=code, name=name, unit=unit, description=description) for code, name, unit, description in VARIABLE_SEEDS])
    bind.execute(sensor_table.insert(), [dict(id=SENSOR_IDS[code], code=code, name=name, manufacturer=manufacturer, description=description) for code, name, manufacturer, description in SENSOR_SEEDS])
    bind.execute(capability_table.insert(), [dict(sensor_id=SENSOR_IDS[s], variable_id=VARIABLE_IDS[v], min_value=lo, max_value=hi, accuracy=accuracy, resolution=resolution) for s, v, lo, hi, accuracy, resolution in SENSOR_VARIABLE_SPECS])

    device_type = sa.table("device_type", sa.column("id", sa.Uuid()), sa.column("code", sa.Text()), sa.column("name", sa.Text()), sa.column("is_active", sa.Boolean()))
    if not bind.execute(sa.select(device_type.c.id).where(device_type.c.id == ENVIRONMENTAL_ID)).first():
        bind.execute(device_type.insert().values(id=ENVIRONMENTAL_ID, code="environmental", name="Ambiental", is_active=True))
    else:
        bind.execute(device_type.update().where(device_type.c.id == ENVIRONMENTAL_ID).values(is_active=True))
    bind.execute(device_type.update().where(device_type.c.id == RELAY_1_ID).values(is_active=False))

    uid, system, admin, members, owners, guests, guest_devices = _identity_fragments()
    for table in ("variable", "sensor", "sensor_variable", "device_sensor", "telemetry"):
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE public."{table}" FORCE ROW LEVEL SECURITY')

    for table in ("variable", "sensor", "sensor_variable"):
        op.execute(f"CREATE POLICY catalog_read ON public.{table} FOR SELECT TO PUBLIC USING ({uid} IS NOT NULL AND {uid} <> '')")
        op.execute(f"CREATE POLICY catalog_insert ON public.{table} FOR INSERT TO PUBLIC WITH CHECK ({system} OR {admin})")
        op.execute(f"CREATE POLICY catalog_update ON public.{table} FOR UPDATE TO PUBLIC USING ({system} OR {admin}) WITH CHECK ({system} OR {admin})")
        op.execute(f"CREATE POLICY catalog_delete ON public.{table} FOR DELETE TO PUBLIC USING ({system} OR {admin})")

    device_read = f"({system} OR {admin} OR device_id IN (SELECT d.id FROM public.device d WHERE d.environment_id IN ({members}) OR d.environment_id IN ({guests}) OR d.id IN ({guest_devices})))"
    device_write = f"({system} OR {admin} OR device_id IN (SELECT d.id FROM public.device d WHERE d.environment_id IN ({owners})))"
    op.execute(f"CREATE POLICY device_sensor_read ON public.device_sensor FOR SELECT TO PUBLIC USING {device_read}")
    op.execute(f"CREATE POLICY device_sensor_insert ON public.device_sensor FOR INSERT TO PUBLIC WITH CHECK {device_write}")
    op.execute(f"CREATE POLICY device_sensor_update ON public.device_sensor FOR UPDATE TO PUBLIC USING {device_write} WITH CHECK {device_write}")
    op.execute(f"CREATE POLICY device_sensor_delete ON public.device_sensor FOR DELETE TO PUBLIC USING {device_write}")
    op.execute(f"CREATE POLICY device_data_access ON public.telemetry FOR SELECT TO PUBLIC USING ({system} OR {admin} OR environment_id IN ({members}) OR environment_id IN ({guests}) OR device_id IN ({guest_devices}))")
    op.execute(f"CREATE POLICY device_data_system_write ON public.telemetry FOR INSERT TO PUBLIC WITH CHECK ({system})")


def downgrade():
    op.execute("DROP TRIGGER set_telemetry_environment_id ON public.telemetry")
    op.execute("DROP FUNCTION public.set_telemetry_environment_id()")
    op.drop_table("telemetry")
    op.drop_table("device_sensor")
    op.drop_table("sensor_variable")
    op.drop_table("sensor")
    op.drop_table("variable")
    bind = op.get_bind()
    device_type = sa.table("device_type", sa.column("id", sa.Uuid()), sa.column("is_active", sa.Boolean()))
    bind.execute(device_type.update().where(device_type.c.id == RELAY_1_ID).values(is_active=True))
    # Keep the row if devices were assigned to it after upgrade (FK-safe).
    bind.execute(device_type.update().where(device_type.c.id == ENVIRONMENTAL_ID).values(is_active=False))
