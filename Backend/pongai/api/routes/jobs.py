"""Endpoints 4, 6, 7 — SSE stream, poll, list.

The SSE endpoint polls Table Storage and pushes on change. The worker never
calls the API; it just writes state. That keeps them independent, which
matters because the worker is a Job that comes and goes.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse

from pongai.api.deps import current_user
from pongai.api.deps import job_id as job_id_dep
from pongai.api.deps import job_or_404, storage
from pongai.api.errors import ApiError
from pongai.core.progress import STAGE_LABELS
from pongai.core.schema import (
    MAX_ATTEMPTS,
    STALE_AFTER_S,
    User,
    Job,
    JobStatus,
    SourceVideo,
    SubmitJobResponse,
)
from pongai.core.storage import OUTPUTS_CONTAINER, UPLOADS_CONTAINER, Storage

log = logging.getLogger(__name__)
router = APIRouter(tags=["jobs"])

POLL_INTERVAL_S = 2.0
KEEPALIVE_S = 15.0
MAX_STREAM_S = 3600.0
# Told to the browser explicitly rather than left to EventSource's default,
# which varies by engine.
CLIENT_RETRY_MS = 3000

# Storage hiccups are worth riding out; a persistent fault is not. Five in a
# row is ~10 seconds of failure, well past anything transient.
MAX_CONSECUTIVE_FAILURES = 5


@router.get("/jobs/{job_id}", response_model=Job, summary="Poll one job")
def get_job(job: Job = Depends(job_or_404)) -> Job:
    """Polling fallback for SSE.

    A 40-minute stream will drop sometimes — proxy restart, laptop sleep,
    network change. Without this, a dropped connection leaves the user on a
    dead page with no way to recover.
    """
    return job


@router.get("/jobs", response_model=list[Job], summary="Recent jobs")
def list_jobs(limit: int = Query(50, ge=1, le=200),
              user: User = Depends(current_user),
              store: Storage = Depends(storage)) -> list[Job]:
    """The caller's own history. Analyses take ~30 minutes; nobody watches."""
    return store.list_jobs(user.user_id, limit)


# Short-lived on purpose. This is the user's raw footage, not a published
# result, and the link only has to outlive one sitting with the player.
SOURCE_SAS_HOURS = 2

# Statuses where the job is committed to a worker. Deleting underneath one
# produces a confusing mid-pipeline failure, and deleting a QUEUED job races a
# replica that may be starting on it right now — the message would be picked up
# moments later with nothing behind it.
#
# QUEUED is included so the UI can tell the truth: the confirmation shown before
# submitting says deletion is unavailable once queued, and that has to hold.
#
# The staleness escape below still applies, so a job that never gets picked up
# does not become permanently undeletable.
BUSY_STATUSES = (JobStatus.QUEUED, JobStatus.VALIDATING, JobStatus.PROCESSING)


def _source_path(job: Job) -> str:
    return f"{job.job_id}/{job.filename or 'input.mp4'}"


@router.get("/jobs/{job_id}/source", response_model=SourceVideo,
            summary="A short-lived link to the uploaded video",
            responses={410: {"description": "the upload is no longer stored"}})
def source(job: Job = Depends(job_or_404),
           store: Storage = Depends(storage)) -> SourceVideo:
    """The raw upload, for playback before any analysis exists.

    GET /analyses/{id} only answers once a job is DONE and serves the RENDERED
    video from `outputs`. This serves what the user actually uploaded, so a
    clip can be watched back the moment it lands.
    """
    path = _source_path(job)
    if not store.blob_exists(UPLOADS_CONTAINER, path):
        # Either the PUT never completed, or the 7-day lifecycle rule has
        # since removed it. Both mean the same thing to a viewer.
        raise ApiError(410, "source_unavailable",
                       "This video is no longer stored.")

    return SourceVideo(
        job_id=job.job_id,
        url=store.read_sas(UPLOADS_CONTAINER, path, hours=SOURCE_SAS_HOURS),
        filename=job.filename,
        size_bytes=job.size_bytes,
        expires_in_s=SOURCE_SAS_HOURS * 3600,
    )


@router.delete("/jobs/{job_id}", status_code=204,
               summary="Delete a job and everything it stored",
               responses={409: {"description": "currently being processed"}})
def delete_job(job: Job = Depends(job_or_404),
               store: Storage = Depends(storage)) -> Response:
    """Remove the upload, any analysis outputs, and the job row.

    Irreversible: blob soft-delete is disabled on the account, so nothing here
    can be recovered afterwards. The client is expected to confirm first.
    """
    if job.status in BUSY_STATUSES and job.seconds_since_update <= STALE_AFTER_S:
        raise ApiError(409, "job_busy",
                       "This video is queued for analysis. Wait for it to "
                       "finish before deleting it.",
                       status=job.status.value, progress=job.progress)

    # Blobs first. A row with no blobs is recoverable noise; blobs with no row
    # are invisible and bill indefinitely.
    removed = store.delete_prefix(UPLOADS_CONTAINER, f"{job.job_id}/")
    removed += store.delete_prefix(OUTPUTS_CONTAINER, f"{job.job_id}/")
    store.delete_job(job)
    log.info("job %s deleted (%d blobs)", job.job_id, removed)

    return Response(status_code=204)


@router.post("/jobs/{job_id}/retry", response_model=SubmitJobResponse,
             summary="Re-queue a failed job",
             responses={409: {"description": "not in a retryable state"},
                        410: {"description": "the uploaded video has expired"}})
def retry(job_id: str = Depends(job_id_dep),
          job: Job = Depends(job_or_404),
          store: Storage = Depends(storage)) -> SubmitJobResponse:
    """Run the same job again, on the same uploaded file.

    The upload is not repeated — the source blob is still there, so a retry
    costs the analysis and nothing else. The job id is stable, so whatever the
    client already holds (its stream URL, its bookmark) keeps working.

    Retries are explicit rather than automatic. A failure that is going to
    happen again should not silently burn three cold starts before anyone
    hears about it, and the user is the one who knows whether it is worth
    another ~30 minutes.
    """
    if job.status is JobStatus.REJECTED:
        raise ApiError(409, "not_retryable",
                       "This video cannot be analysed, so trying again would "
                       "reach the same result. Please upload a different "
                       "recording.", rejections=job.rejections)
    if job.status is JobStatus.DONE:
        raise ApiError(409, "already_done",
                       "This analysis already finished.",
                       analysis_url=f"/api/analyses/{job.job_id}")
    if job.status is JobStatus.AWAITING_UPLOAD:
        raise ApiError(409, "never_submitted",
                       "This upload was never submitted for analysis.")
    if job.attempts >= MAX_ATTEMPTS:
        raise ApiError(409, "attempts_exhausted",
                       f"This job has already been attempted {job.attempts} "
                       f"times. Please upload the recording again.",
                       attempts=job.attempts, max_attempts=MAX_ATTEMPTS)
    if not job.can_retry:
        # QUEUED, or running and still writing progress.
        raise ApiError(409, "still_running",
                       "This job is still being processed.",
                       status=job.status.value,
                       progress=job.progress)

    # Raw uploads are deleted after 7 days by the storage lifecycle rule, so a
    # job can outlive the file it was made from. Checked before enqueueing:
    # otherwise the worker would spend a cold start to discover it and the
    # user would get a second, slower, less clear failure.
    blob_path = f"{job.job_id}/{job.filename or 'input.mp4'}"
    if not store.blob_exists(UPLOADS_CONTAINER, blob_path):
        raise ApiError(410, "source_expired",
                       "The uploaded video is no longer available. Uploads "
                       "are kept for 7 days. Please upload it again.")

    depth = store.queue_depth()
    job.reset_for_retry()
    store.put_job(job)
    store.enqueue(job.user_id, job.job_id)
    log.info("job %s retry #%d queued behind %d", job.job_id, job.attempts, depth)

    est = None
    if job.probe or job.client_probe:
        p = job.probe or job.client_probe
        est = p.estimated_gpu_seconds * (depth + 1) + 240

    return SubmitJobResponse(job_id=job.job_id, status=job.status,
                             queue_position=depth, estimated_wait_s=est)


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


@router.get("/jobs/{job_id}/stream", summary="SSE progress")
async def stream(request: Request, job_id: str = Depends(job_id_dep),
                 user: User = Depends(current_user),
                 store: Storage = Depends(storage)) -> StreamingResponse:
    """Server-sent events until the job reaches a terminal state.

    Client should close on `done` or `error`. On `timeout` — which is not a
    failure, just this connection's 60-minute cap — it should reconnect. If
    the stream drops and EventSource cannot reconnect, fall back to polling
    GET /jobs/{id}.
    """

    async def gen():
        last: dict | None = None
        warned = False
        # Wall clock, not a count of sleeps: each iteration also costs a table
        # read, so summing POLL_INTERVAL_S drifts long and the 60-minute cap
        # would fire late.
        started = time.monotonic()
        last_keepalive = started
        consecutive_failures = 0

        yield f"retry: {CLIENT_RETRY_MS}\n\n"

        while time.monotonic() - started < MAX_STREAM_S:
            if await request.is_disconnected():
                log.info("client disconnected from job %s stream", job_id)
                return

            # blocking SDK call — off the event loop so one slow read does not
            # stall every other connection
            try:
                job = await asyncio.to_thread(
                    store.get_job, user.user_id, job_id)
            except Exception:
                # A transient storage error must not kill a 40-minute stream;
                # the next poll will very likely succeed. A PERMANENT one must
                # not be retried for the full hour, though — that holds a
                # connection open and polls the table 1800 times to keep
                # failing. Give up after a few in a row and let the client
                # fall back to GET /jobs/{id}.
                consecutive_failures += 1
                log.warning("job %s stream: storage read failed (%d in a row)",
                            job_id, consecutive_failures, exc_info=True)
                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    yield _event("error", {
                        "code": "stream_unavailable",
                        "message": "Progress updates are unavailable. "
                                   "Reload to check on this analysis."})
                    return
                await asyncio.sleep(POLL_INTERVAL_S)
                continue
            consecutive_failures = 0

            if job is None:
                yield _event("error", {"code": "job_not_found",
                                       "message": f"Job {job_id} not found."})
                return

            # Non-blocking problems, sent once. The user is about to wait half
            # an hour; they should know now that swing speed will be missing.
            if not warned and job.warnings:
                warned = True
                yield _event("warning", {
                    "job_id": job_id,
                    "warnings": [w.model_dump(mode="json")
                                 for w in job.warnings]})

            snap = _snapshot(job)
            if snap != last:
                # copy BEFORE adding `message`, or the comparison key differs
                # from the emitted payload and every poll looks like a change
                last = dict(snap)
                snap["message"] = _message(job)
                yield _event("status", snap)
                last_keepalive = time.monotonic()

            if job.status == JobStatus.DONE:
                yield _event("done", {
                    "job_id": job_id,
                    "analysis_url": f"/api/analyses/{job_id}"})
                return

            if job.status in (JobStatus.FAILED, JobStatus.REJECTED):
                yield _event("error", {
                    "job_id": job_id,
                    "code": job.error_code or job.status.value,
                    "message": job.error_message or _message(job),
                    "rejections": [r.model_dump(mode="json")
                                   for r in job.rejections],
                })
                return

            # Without periodic traffic the ingress or an intermediate proxy
            # closes an idle connection.
            if time.monotonic() - last_keepalive >= KEEPALIVE_S:
                yield ": ping\n\n"
                last_keepalive = time.monotonic()

            await asyncio.sleep(POLL_INTERVAL_S)

        # Not a failure. Its own event name so the client reconnects rather
        # than treating it as `error` and closing, which is what the documented
        # "close on done or error" contract would otherwise make it do.
        yield _event("timeout", {
            "job_id": job_id,
            "message": "This connection reached its time limit. Reconnecting.",
            "reconnect": True})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-store",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",     # or the proxy buffers and nothing arrives
    })
