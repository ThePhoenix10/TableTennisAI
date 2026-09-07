"""Endpoints 4, 6, 7 — SSE stream, poll, list.

The SSE endpoint polls Table Storage and pushes on change. The worker never
calls the API; it just writes state. That keeps them independent, which
matters because the worker is a Job that comes and goes.
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from pongai.api.deps import job_or_404, storage
from pongai.core.progress import STAGE_LABELS
from pongai.core.schema import Job, JobStatus
from pongai.core.storage import Storage

log = logging.getLogger(__name__)
router = APIRouter(tags=["jobs"])

POLL_INTERVAL_S = 2.0
KEEPALIVE_S = 15.0
MAX_STREAM_S = 3600.0


@router.get("/jobs/{job_id}", response_model=Job)
def get_job(job: Job = Depends(job_or_404)) -> Job:
    """Polling fallback for SSE.

    A 40-minute stream will drop sometimes — proxy restart, laptop sleep,
    network change. Without this, a dropped connection leaves the user on a
    dead page with no way to recover.
    """
    return job


@router.get("/jobs", response_model=list[Job])
def list_jobs(limit: int = Query(50, le=200),
              store: Storage = Depends(storage)) -> list[Job]:
    """History. Analyses take ~30 minutes; nobody sits and watches."""
    return store.list_jobs(limit)


def _event(name: str, payload: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(payload)}\n\n"


def _snapshot(job: Job) -> dict:
    return {
        "job_id": job.job_id,
        "status": job.status.value,
        "stage": job.stage.value if job.stage else None,
        "stage_label": STAGE_LABELS.get(job.stage) if job.stage else None,
        "progress": round(job.progress, 4),
        "eta_s": round(job.eta_s) if job.eta_s is not None else None,
    }


def _message(job: Job) -> str:
    """What the user reads. The queued state needs its own wording — the GPU
    scales to zero, so the first job after an idle period waits several
    minutes for a node and an image pull. Saying only 'queued' for six
    minutes reads as broken."""
    if job.status == JobStatus.AWAITING_UPLOAD:
        return "Waiting for the upload to finish."
    if job.status == JobStatus.QUEUED:
        return ("Starting the GPU worker. The first analysis after an idle "
                "period takes a few minutes to warm up.")
    if job.status == JobStatus.VALIDATING:
        return "Checking the video."
    if job.status == JobStatus.PROCESSING and job.stage:
        return STAGE_LABELS.get(job.stage, "Processing.")
    if job.status == JobStatus.DONE:
        return "Analysis complete."
    if job.status == JobStatus.REJECTED:
        return "This video could not be analysed."
    if job.status == JobStatus.FAILED:
        return "Something went wrong during analysis."
    return "Processing."


@router.get("/jobs/{job_id}/stream")
async def stream(job_id: str, request: Request,
                 store: Storage = Depends(storage)) -> StreamingResponse:
    """Server-sent events until the job reaches a terminal state.

    Client should close on `done` or `error`, and fall back to polling
    GET /jobs/{id} if the stream drops and EventSource cannot reconnect.
    """

    async def gen():
        last: dict | None = None
        elapsed = 0.0
        since_keepalive = 0.0

        while elapsed < MAX_STREAM_S:
            if await request.is_disconnected():
                log.info("client disconnected from job %s stream", job_id)
                return

            # blocking SDK call — off the event loop so one slow read does not
            # stall every other connection
            job = await asyncio.to_thread(store.get_job, job_id)
            if job is None:
                yield _event("error", {"code": "not_found",
                                       "message": f"job {job_id} not found"})
                return

            snap = _snapshot(job)
            if snap != last:
                # copy BEFORE adding `message`, or the comparison key differs
                # from the emitted payload and every poll looks like a change
                last = dict(snap)
                snap["message"] = _message(job)
                yield _event("status", snap)
                since_keepalive = 0.0

            if job.status == JobStatus.DONE:
                yield _event("done", {
                    "job_id": job_id,
                    "analysis_url": f"/api/analyses/{job_id}"})
                return

            if job.status in (JobStatus.FAILED, JobStatus.REJECTED):
                yield _event("error", {
                    "code": job.error_code or job.status.value,
                    "message": job.error_message or _message(job),
                    "rejections": [r.model_dump(mode="json")
                                   for r in job.rejections],
                })
                return

            # Without periodic traffic the ingress or an intermediate proxy
            # closes an idle connection.
            if since_keepalive >= KEEPALIVE_S:
                yield ": ping\n\n"
                since_keepalive = 0.0

            await asyncio.sleep(POLL_INTERVAL_S)
            elapsed += POLL_INTERVAL_S
            since_keepalive += POLL_INTERVAL_S

        yield _event("error", {"code": "stream_timeout",
                               "message": "Stream timed out. Reconnecting."})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",     # or the proxy buffers and nothing arrives
    })
