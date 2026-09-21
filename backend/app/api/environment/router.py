from fastapi import APIRouter

from app.api.environment.environment.router import router as env_router
from app.api.environment.environment_type.router import router as env_type_router
from app.api.environment.invitation.router import router as inv_router

router = APIRouter(prefix="/environment", tags=["Environment"])

router.include_router(env_type_router, prefix="/types", tags=["Environment Types"])
router.include_router(inv_router, prefix="", tags=["Invitations"]) # Endpoints are like /environment/{id}/invitations so no prefix here
router.include_router(env_router, prefix="", tags=["Environments"])
