"""Import every ORM model so SQLAlchemy can resolve string relationships.

Processes that do not load the API routers (the standalone MQTT runtime) must
import this module; otherwise relationships such as ``Environment.invitations``
fail to configure on the first database access.
"""

from app.api.access.models import ScopedGuestInvitation, ScopedGuestRelation  # noqa: F401
from app.api.auth.models import User  # noqa: F401
from app.api.device.device_type.models import DeviceTypeCatalog  # noqa: F401
from app.api.device.models import Device, DeviceLocationReport  # noqa: F401
from app.api.device.operations.models import DeviceOperation  # noqa: F401
from app.api.environment.environment.models import Environment, EnvironmentUser  # noqa: F401
from app.api.environment.environment_type.models import EnvironmentType  # noqa: F401
from app.api.environment.invitation.models import EnvironmentInvitation  # noqa: F401
from app.api.location.models import LocationCity, LocationCountry, LocationState  # noqa: F401
from app.api.sensor.models import SensorReading, Telemetry  # noqa: F401
from app.api.sensor_catalog.models import DeviceSensor, Sensor, SensorVariable, Variable  # noqa: F401
from app.api.tax.identification_type.models import IdentificationType  # noqa: F401
