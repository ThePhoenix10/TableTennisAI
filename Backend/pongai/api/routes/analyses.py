"""Endpoint 5 — the result."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response

from pongai.api.deps import job_id as job_id_dep
from pongai.api.deps import job_or_404, storage
from pongai.api.errors import ApiError
from pongai.core.schema import Analysis, AnalysisMeta, Job, JobStatus, Shot
from pongai.core.storage import OUTPUTS_CONTAINER, Storage

log = logging.getLogger(__name__)
router = APIRouter(tags=["analyses"])

SAS_HOURS = 24


@router.get("/analyses/{job_id}", response_model=Analysis,
            summary="Results plus signed URLs",
            responses={409: {"description": "job exists but is not finished"}})
def get_analysis(response: Response,
                 job_id: str = Depends(job_id_dep),
                 job: Job = Depends(job_or_404),
                 store: Storage = Depends(storage)) -> Analysis:
    if job.status != JobStatus.DONE:
        # 409 rather than 404: the job exists, it is just not ready. The
        # client can keep polling on this.
        raise ApiError(409, "not_ready", f"This analysis is {job.status.value}.",
                       status=job.status.value, progress=job.progress)

    try:
        payload = store.read_json(OUTPUTS_CONTAINER, f"{job_id}/shots.json")
    except Exception as e:
        log.error("job %s done but results unreadable: %s", job_id, e)
        raise ApiError(500, "results_missing",
                       "This job finished but its results are missing.") from e

    def sas(name: str) -> str:
        return store.read_sas(OUTPUTS_CONTAINER, f"{job_id}/{name}",
                              hours=SAS_HOURS)

    # The signed URLs in this body expire. A cached copy hands the client
    # dead links, so this response must never be stored by a proxy.
    response.headers["Cache-Control"] = "no-store"

    return Analysis(
        meta=AnalysisMeta(**payload["meta"]),
        shots=[Shot(**s) for s in payload["shots"]],
        video_url=sas("video.mp4"),
        track_url=sas("track.json"),
        track_bin_url=sas("track.bin"),
        thumb_url=(sas("thumb.jpg")
                   if store.blob_exists(OUTPUTS_CONTAINER, f"{job_id}/thumb.jpg")
                   else None),
    )
