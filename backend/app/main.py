import logging
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from app.api.router import router as api_router
from app.core.config import settings
from app.core.logging_config import quiet_http_client_logs
from app.core.mqtt.client import mqtt_client


load_dotenv()

logging.basicConfig(level=logging.INFO)
quiet_http_client_logs()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.core.init_data import create_default_admin

    create_default_admin()

    # Keep the API publisher-only. Generic ingestion remains isolated in
    # app.main_runtime so API startup cannot activate device writes.
    mqtt_client.start()

    yield

    mqtt_client.stop()


app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
    openapi_url=None if settings.ENVIRONMENT == "PROD" else "/api/openapi.json",
    docs_url=None if settings.ENVIRONMENT == "PROD" else "/api/docs",
    redoc_url=None,
    swagger_ui_parameters={"persistAuthorization": True},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.BACKEND_TRUSTED_HOSTS
    or ["localhost"],
)

app.include_router(api_router, prefix="/api")


@app.get("/")
def read_root():
    return {"message": "Hola Mundo!"}


@app.get("/health")
def health_check():
    return {"status": "ok"}
