"""pongai.api.deps — FastAPI dependencies."""
from __future__ import annotations

import re

from fastapi import Depends, Path

from pongai.api.errors import ApiError
from pongai.core.schema import Job
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


def job_or_404(jid: str = Depends(job_id),
               store: Storage = Depends(storage)) -> Job:
    job = store.get_job(jid)
    if not job:
        raise ApiError(404, "job_not_found", f"job {jid} not found")
    return job
