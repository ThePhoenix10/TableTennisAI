"""Endpoint 5 — the result."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from pongai.api.deps import job_or_404, storage
from pongai.core.schema import Analysis, AnalysisMeta, Job, JobStatus, Shot
from pongai.core.storage import OUTPUTS_CONTAINER, Storage

log = logging.getLogger(__name__)
router = APIRouter(tags=["analyses"])

SAS_HOURS = 24


@router.get("/analyses/{job_id}", response_model=Analysis)
def get_analysis(job_id: str, job: Job = Depends(job_or_404),
                 store: Storage = Depends(storage)) -> Analysis:
    if job.status != JobStatus.DONE:
        # 409 rather than 404: the job exists, it is just not ready. The
        # client can keep polling on this.
        raise HTTPException(409, detail={
            "status": job.status.value,
            "progress": job.progress,
            "message": f"analysis is {job.status.value}",
        })

    try:
        payload = store.read_json(OUTPUTS_CONTAINER, f"{job_id}/shots.json")
    except Exception as e:
        log.error("job %s done but results unreadable: %s", job_id, e)
        raise HTTPException(500, "job is done but its results are missing")

    sas = lambda name: store.read_sas(
        OUTPUTS_CONTAINER, f"{job_id}/{name}", hours=SAS_HOURS)

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
