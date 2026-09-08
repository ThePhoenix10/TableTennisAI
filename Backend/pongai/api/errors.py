"""
pongai.api.errors — one error envelope for every failure.

Before this, three shapes came out of the API: a bare string `detail`, a dict
with `rejections`, and a dict with `status`/`progress`. The client had to
sniff which one it got. Everything now lands as:

    {"error": {"code": ..., "message": ..., "rejections": [...], "context": {...}}}

`code` is machine-readable and stable; `message` is what a user can read.
`rejections` is present only for validation failures and carries the same
Rejection records `core.validation` produces, so the wording the browser
showed at upload and the wording the API returns cannot disagree.
"""
from __future__ import annotations

import logging

from azure.core.exceptions import AzureError
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from pongai.core.validation import Rejection

log = logging.getLogger(__name__)


def envelope(code: str, message: str,
             rejections: list[Rejection] | None = None,
             **context) -> dict:
    body: dict = {"code": code, "message": message}
    if rejections is not None:
        body["rejections"] = [r.model_dump(mode="json") for r in rejections]
    if context:
        body["context"] = context
    return {"error": body}


class ApiError(HTTPException):
    """An HTTPException that already carries an envelope."""

    def __init__(self, status_code: int, code: str, message: str,
                 rejections: list[Rejection] | None = None, **context):
        super().__init__(status_code,
                         detail=envelope(code, message, rejections, **context))


def install(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def _http(_: Request, exc: HTTPException):
        # Already an envelope (ApiError) — pass it through untouched.
        if isinstance(exc.detail, dict) and "error" in exc.detail:
            return JSONResponse(exc.detail, status_code=exc.status_code,
                                headers=exc.headers)
        return JSONResponse(
            envelope(f"http_{exc.status_code}", str(exc.detail)),
            status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        return JSONResponse(
            envelope("invalid_request", "The request body was not valid.",
                     errors=jsonable_encoder(exc.errors())),
            status_code=422)

    @app.exception_handler(AzureError)
    async def _azure(req: Request, exc: AzureError):
        # Storage being unreachable is not the caller's fault and is usually
        # transient. 503 tells the client to retry; 500 tells it to give up.
        log.error("storage error on %s %s: %s", req.method, req.url.path, exc)
        return JSONResponse(
            envelope("storage_unavailable",
                     "Storage is temporarily unreachable. Please retry."),
            status_code=503)

    @app.exception_handler(KeyError)
    async def _config(req: Request, exc: KeyError):
        # get_storage() raises KeyError when the connection string is unset.
        # Without this the container answers every request with an opaque 500.
        log.error("configuration error on %s: missing %s", req.url.path, exc)
        return JSONResponse(
            envelope("not_configured",
                     "The service is not configured correctly."),
            status_code=503)

    @app.exception_handler(Exception)
    async def _unhandled(req: Request, exc: Exception):
        log.exception("unhandled error on %s %s", req.method, req.url.path)
        return JSONResponse(
            envelope("internal_error", "Something went wrong."),
            status_code=500)
