"""FastAPI application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import api_router
from app.config import get_settings
from app.services.jobs.runner import load_handlers, start_inline_worker, stop_inline_worker


def configure_logging() -> None:
    s = get_settings()
    logging.basicConfig(level=getattr(logging, s.log_level.upper(), logging.INFO),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    s.effective_secret_key  # fail fast in production when SECRET_KEY is missing  # noqa: B018
    load_handlers()
    if s.run_worker_inline:
        start_inline_worker()
    try:
        yield
    finally:
        stop_inline_worker()


def create_app() -> FastAPI:
    configure_logging()
    s = get_settings()
    app = FastAPI(title="Elets PressFlow AI API", version="0.1.0", lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        errors = [{"loc": [str(x) for x in e.get("loc", [])], "msg": e.get("msg"), "type": e.get("type")}
                  for e in exc.errors()][:20]
        return JSONResponse(status_code=422, content={"detail": "Request validation failed", "errors": errors})

    app.include_router(api_router)
    return app


app = create_app()
