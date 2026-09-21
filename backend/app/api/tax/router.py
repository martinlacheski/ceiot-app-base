from fastapi import APIRouter

from app.api.tax.identification_type.router import router as identification_type_router

router = APIRouter(prefix="/tax", tags=["tax"])

router.include_router(identification_type_router, prefix="/identification-types", tags=["Identification Types"])
