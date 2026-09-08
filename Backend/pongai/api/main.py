"""
pongai.api.main — FastAPI service.

Deployed as a Container App with min 1 replica. It stays warm because the SSE
endpoint holds connections for 25-40 minutes; a cold start mid-stream drops
them. Only the GPU worker scales to zero, and that is where the cost is.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from pongai.api import errors
from pongai.api.routes import analyses, jobs, meta, uploads
from pongai.core.storage import get_storage

log = logging.getLogger("pongai.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        get_storage().ensure_resources()
        log.info("storage ready")
    except Exception as e:
        # Let the container start so /health responds and the platform can
        # report the problem, rather than crash-looping. Requests then fail
        # with a 503 from the handlers in `errors`, not an opaque 500.
        log.error("storage init failed: %s", e)
    yield


app = FastAPI(
    title="PongAI",
    version="0.1.0",
    description="Table-tennis video analysis from body pose alone.",
    lifespan=lifespan,
)

errors.install(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
    # Every method the API actually exposes. DELETE and OPTIONS are easy to
    # forget: the browser preflights any non-simple method, and a missing entry
    # surfaces as "400 Disallowed CORS method" from the middleware rather than
    # anything resembling a routing problem.
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    # The browser reads Content-Type off the SSE and JSON responses; without
    # this it cannot see any non-safelisted response header.
    expose_headers=["Content-Type", "Cache-Control"],
    max_age=3600,
)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """The bare host answered 404, which reads as a broken deployment when
    someone opens the API URL to check it is up."""
    return RedirectResponse("/docs")


for r in (meta.router, uploads.router, jobs.router, analyses.router):
    app.include_router(r, prefix="/api")
