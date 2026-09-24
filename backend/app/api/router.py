from fastapi import APIRouter
from app.api.auth.router import router as auth_router
from app.api.location.router import router as location_router
from app.api.tax.router import router as tax_router
from app.api.environment.router import router as environment_router
from app.api.access.router import router as access_router
from app.api.public.router import router as public_router
from app.api.device.device_type.router import router as device_type_router
from app.api.provisioning.router import router as provisioning_router
from app.api.sensor_catalog.router import catalog_router, device_router as sensor_device_router

router = APIRouter()

# Public endpoints (no auth required)
router.include_router(public_router, prefix="/public", tags=["public"])

router.include_router(auth_router)
router.include_router(location_router)
router.include_router(tax_router)
router.include_router(environment_router)
router.include_router(access_router)
from app.api.device.router import router as device_router
from app.api.device.operations.router import router as operations_router
from app.api.device.history.router import router as history_router

router.include_router(provisioning_router, prefix="/provisioning", tags=["Provisioning"])
router.include_router(device_type_router, prefix="/devices/types", tags=["Device Types"])
router.include_router(history_router, prefix="/devices/history", tags=["Device History"])
router.include_router(device_router, prefix="/devices", tags=["Devices"])
router.include_router(catalog_router, prefix="/sensor-catalog", tags=["Sensor Catalog"])
router.include_router(sensor_device_router, prefix="/devices", tags=["Device Sensors and Telemetry"])
router.include_router(
    operations_router, prefix="/devices/operations", tags=["Device Operations"]
)


@router.get("/health")
def health():
    return {"status": "ok"}
