"""Endpoints 2, 3 — create upload, submit job.

Split deliberately. A SAS can be issued and the upload then fail at 70%. If
POST /uploads enqueued the job, the worker would pick up a truncated file and
fail deep in the pipeline with a confusing error. The job only enters the
queue once the blob is verified.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from pongai.api.deps import job_or_404, storage
from pongai.core.schema import (
    CreateUploadRequest,
    CreateUploadResponse,
    Job,
    JobStatus,
    SubmitJobResponse,
    utcnow,
)
from pongai.core.storage import UPLOADS_CONTAINER, Storage
from pongai.core.validation import (
    Limits,
    Rejection,
    RejectionCode,
    blocking,
    is_acceptable,
    validate_probe,
)

log = logging.getLogger(__name__)
router = APIRouter(tags=["uploads"])


def _reject(status: int, rejections: list[Rejection]):
    return HTTPException(status, detail={
        "rejections": [r.model_dump(mode="json") for r in rejections]})


@router.post("/uploads", response_model=CreateUploadResponse)
def create_upload(req: CreateUploadRequest,
                  store: Storage = Depends(storage)) -> CreateUploadResponse:
    """Returns a scoped SAS. The browser PUTs the file to blob directly —
    a 100 MB body through this service would occupy a worker for the whole
    upload and hit request size limits."""

    if req.size_bytes > Limits.MAX_SIZE_BYTES:
        raise _reject(413, [Rejection(
            code=RejectionCode.FILE_TOO_LARGE,
            message=f"This file is {req.size_bytes/1e6:.0f} MB. The limit is "
                    f"{Limits.MAX_SIZE_BYTES//1024//1024} MB.")])

    # If the client probed the file, reject obvious problems before a 100 MB
    # upload rather than after. Advisory only — the worker re-checks.
    if req.probe:
        rej = validate_probe(req.probe)
        if not is_acceptable(rej):
            raise _reject(422, blocking(rej))

    job_id = store.new_job_id()
    url, blob_path, expires = store.upload_sas(
        job_id, req.filename, req.content_type)

    store.put_job(Job(
        job_id=job_id,
        status=JobStatus.AWAITING_UPLOAD,
        created_at=utcnow(),
        updated_at=utcnow(),
        filename=req.filename,
        size_bytes=req.size_bytes,
        client_probe=req.probe,
    ))
    log.info("job %s created: %s, %.1f MB", job_id, req.filename,
             req.size_bytes / 1e6)

    return CreateUploadResponse(
        job_id=job_id, upload_url=url, blob_path=blob_path,
        expires_at=expires, max_size_bytes=Limits.MAX_SIZE_BYTES)


@router.post("/jobs/{job_id}/submit", response_model=SubmitJobResponse)
def submit(job_id: str, job: Job = Depends(job_or_404),
           store: Storage = Depends(storage)) -> SubmitJobResponse:
    """Called by the client once the blob PUT completes."""

    if job.status == JobStatus.QUEUED:
        # Idempotent — a retried request should not double-enqueue.
        return SubmitJobResponse(job_id=job_id, status=job.status,
                                 queue_position=store.queue_depth())
    if job.status != JobStatus.AWAITING_UPLOAD:
        raise HTTPException(409, f"job is already {job.status.value}")

    blob_path = f"{job_id}/{job.filename}"
    actual = store.blob_size(UPLOADS_CONTAINER, blob_path)
    if actual is None:
        raise HTTPException(400,
                            "upload not found — did the PUT complete?")

    # A truncated upload is a common failure and produces a confusing error
    # deep in the pipeline. Catch it here, where the message can be clear.
    if job.size_bytes and abs(actual - job.size_bytes) > 1024:
        job.status = JobStatus.REJECTED
        job.rejections = [Rejection(
            code=RejectionCode.UNREADABLE,
            message="The upload looks incomplete. Please try again.",
            detail=f"expected {job.size_bytes} bytes, blob has {actual}")]
        store.put_job(job)
        raise _reject(400, job.rejections)

    depth = store.queue_depth()
    job.status = JobStatus.QUEUED
    store.put_job(job)
    store.enqueue(job_id)
    log.info("job %s queued behind %d", job_id, depth)

    # ~5x realtime, plus whatever is ahead, plus a cold start if the GPU has
    # scaled to zero.
    est = None
    if job.client_probe:
        est = job.client_probe.estimated_gpu_seconds * (depth + 1) + 240

    return SubmitJobResponse(job_id=job_id, status=JobStatus.QUEUED,
                             queue_position=depth, estimated_wait_s=est)
