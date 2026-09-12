"""pongai.api.deps — FastAPI dependencies."""
from __future__ import annotations

import re

from fastapi import Depends, Path, Request, Response

from pongai.api.errors import ApiError
from pongai.core.auth import (
    AuthConfigError,
    InvalidToken,
    create_token,
    decode_token,
    should_refresh,
)
from pongai.core.schema import Job, User
from pongai.core.storage import Storage, get_storage, is_job_id

# The id rule itself lives in core.storage, next to the OData filter it
# protects, because the worker reaches get_job without passing through a
# route. This layer only decides what a bad id looks like over HTTP: a 404,
# not a 500 from the SDK.
DEMO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def storage() -> Storage:
    return get_storage()


def job_id(job_id: str = Path(..., min_length=1)) -> str:
    if not is_job_id(job_id):
        raise ApiError(404, "job_not_found", f"job {job_id!r} not found")
    return job_id


def demo_id(demo_id: str = Path(..., min_length=1)) -> str:
    # A demo id becomes a blob path segment.
    if not DEMO_ID_RE.fullmatch(demo_id):
        raise ApiError(404, "demo_not_found", f"demo {demo_id!r} not found")
    return demo_id


# =============================================================================
# Authentication
# =============================================================================

def current_user(request: Request, response: Response,
                 store: Storage = Depends(storage)) -> User:
    """The signed-in account, or 401.

    Sliding expiry: when a token is past halfway through its hour, a fresh one
    is returned in `X-Refresh-Token` and the client swaps it in. An analysis
    runs for ~25 minutes with the page polling throughout, so a hard cut at 60
    minutes would sign people out while they watch their own upload. Reissuing
    on *every* request would churn the stored token for no benefit.
    """
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError(401, "not_authenticated", "Please sign in.")

    try:
        claims = decode_token(token)
    except InvalidToken as e:
        raise ApiError(401, "session_expired",
                       "Your session has expired. Please sign in again."
                       if str(e) == "expired" else
                       "Please sign in again.") from e
    except AuthConfigError as e:
        # Misconfiguration, not the caller's fault.
        raise ApiError(503, "not_configured",
                       "The service is not configured correctly.") from e

    user = store.get_user_by_email(claims["email"])
    if user is None or user.user_id != claims["sub"]:
        # The account was deleted, or the token predates a change to it.
        raise ApiError(401, "not_authenticated", "Please sign in again.")

    if should_refresh(claims):
        response.headers["X-Refresh-Token"] = create_token(
            user.user_id, user.email)

    return user


def job_or_404(jid: str = Depends(job_id),
               user: User = Depends(current_user),
               store: Storage = Depends(storage)) -> Job:
    """One of the caller's own jobs.

    Someone else's job is reported as missing rather than forbidden: a 403
    would confirm the id exists, turning this into a way to probe for them.
    """
    job = store.get_job(user.user_id, jid)
    if not job:
        raise ApiError(404, "job_not_found", f"job {jid} not found")
    return job
