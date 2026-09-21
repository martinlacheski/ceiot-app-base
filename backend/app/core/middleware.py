
import time
from urllib import response
import uuid
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

BLACKLIST = {}


def register_middleware(app: FastAPI):

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            f"{settings.VITE_FRONTEND_URL}:{settings.VITE_FRONTEND_PORT}"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"]
    )

    # Middleware para medir el tiempo de respuesta
    @app.middleware("http")
    async def add_process_time_header(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        # Se agrega el tiempo de respuesta en la cabecera
        process_time = time.perf_counter() - start
        response.headers["X-Process-Time"] = f"{process_time:.4f} segundos"
        return response

    # Middleware para registrar las peticiones
    @app.middleware("http")
    async def log_request(request: Request, call_next):
        # Se imprimen los datos de la peticion
        print(f"**ENTRADA: {request.method} {request.url} **")
        response = await call_next(request)
        # Se imprimen los datos de la respuesta
        print(f"**SALIDA: {response.status_code} **")
        return response

    # Middleware para agregar un id a la peticion
    @app.middleware("http")
    async def add_request_id_header(request: Request, call_next):
        # Se agrega un id a la peticion
        request_id = str(uuid.uuid4())
        response = await call_next(request)
        # Se agrega el id a la cabecera de la respuesta
        response.headers["X-Request-ID"] = request_id
        return response

    # Middleware para bloquear IPs
    @app.middleware("http")
    async def block_ip_middleware(request: Request, call_next):
        # Se verifica si la IP esta en la lista negra
        client_ip = request.client.host
        if client_ip in BLACKLIST:
            raise HTTPException(
                status_code=403, detail="Acceso denegado a esta IP")
        return await call_next(request)
