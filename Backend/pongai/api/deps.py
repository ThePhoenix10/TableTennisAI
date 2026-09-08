"""pongai.api.deps — FastAPI dependencies."""
from __future__ import annotations

from fastapi import Depends, HTTPException

from pongai.core.schema import Job
from pongai.core.storage import Storage, get_storage


def storage() -> Storage:
    return get_storage()


def job_or_404(job_id: str, store: Storage = Depends(storage)) -> Job:
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(404, f"job {job_id} not found")
    return job
