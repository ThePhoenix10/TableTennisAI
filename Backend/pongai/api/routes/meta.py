"""Endpoints 1, 8, 9 — health, limits, demos."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from pongai.api.deps import demo_id as demo_id_dep
from pongai.api.deps import storage
from pongai.api.errors import ApiError
from pongai.core.schema import (
    AnalysisMeta,
    DemoAnalysis,
    DemoSummary,
    Shot,
    model_payload,
    utcnow,
)
from pongai.core.storage import DEMOS_CONTAINER, Storage
from pongai.core.validation import limits_payload

log = logging.getLogger(__name__)
router = APIRouter(tags=["meta"])


@router.get("/health", summary="Liveness")
def health() -> dict:
    """Container Apps liveness probe. Deliberately does not touch storage —
    a transient storage blip should not restart the container."""
    return {"status": "ok", "time": utcnow().isoformat()}


@router.get("/ready", summary="Readiness")
def ready(store: Storage = Depends(storage)) -> dict:
    """Readiness. This one does check storage."""
    try:
        depth = store.queue_depth()
    except Exception as e:
        raise ApiError(503, "storage_unavailable",
                       "Storage is unreachable.") from e
    return {"status": "ready", "queue_depth": depth}


@router.get("/limits", summary="Constraints and model capability")
def limits() -> dict:
    """Served so the browser validates against the same numbers the worker
    enforces. A hardcoded copy in the frontend would drift, producing the
    confusing case where the browser accepts what the worker rejects.

    `model` carries the same argument one module over: per-class precision and
    the position/velocity kinematics split live in core.schema, and the
    frontend needs both to decide what to suppress from findings.
    """
    return {**limits_payload(), "model": model_payload()}


def _demo_urls(store: Storage, vid: str) -> dict:
    """Only sign URLs for blobs that exist. A SAS for a missing blob is a
    valid-looking link that 404s at play time, which is harder to diagnose
    than a null."""
    def maybe(name: str) -> str | None:
        path = f"{vid}/{name}"
        return (store.read_sas(DEMOS_CONTAINER, path)
                if store.blob_exists(DEMOS_CONTAINER, path) else None)
    return {
        "video_url": maybe("video.mp4"),
        "track_url": maybe("track.json"),
        "track_bin_url": maybe("track.bin"),
        "thumb_url": maybe("thumb.jpg"),
    }


@router.get("/demos", response_model=list[DemoSummary],
            summary="Precomputed matches")
def demos(store: Storage = Depends(storage)) -> list[DemoSummary]:
    """Precomputed matches. Goes through the API rather than static frontend
    files so demo and real analyses share one code path."""
    try:
        index = store.read_json(DEMOS_CONTAINER, "index.json")
    except Exception:
        log.warning("no demo index found")
        return []

    out = []
    for d in index.get("demos", []):
        vid = d.get("id")
        if not vid:
            log.warning("demo index entry with no id, skipping")
            continue
        urls = _demo_urls(store, vid)
        if not urls["video_url"] and not d.get("video_url"):
            # Listing a demo whose video is missing puts a dead tile on the
            # landing page — the first thing a new user clicks.
            log.warning("demo %s has no video blob, omitting from index", vid)
            continue
        out.append(DemoSummary(**{**d, **urls,
                                  "video_url": d.get("video_url")
                                  or urls["video_url"],
                                  "analysis_url": f"/api/demos/{vid}"}))
    return out


@router.get("/demos/{demo_id}", response_model=DemoAnalysis,
            summary="One demo, in the same shape as an analysis")
def demo(demo_id: str = Depends(demo_id_dep),
         store: Storage = Depends(storage)) -> DemoAnalysis:
    try:
        payload = store.read_json(DEMOS_CONTAINER, f"{demo_id}/shots.json")
    except Exception as e:
        raise ApiError(404, "demo_not_found", f"Demo {demo_id} not found.") from e

    urls = _demo_urls(store, demo_id)
    video = payload.get("video_url") or urls["video_url"]
    if not video:
        raise ApiError(404, "demo_incomplete",
                       f"Demo {demo_id} has no video.")

    # Validated against the same models as a real analysis. Returning a raw
    # dict here is how "the same shape as /analyses/{id}" quietly stops being
    # true.
    return DemoAnalysis(
        meta=AnalysisMeta(**payload["meta"]),
        shots=[Shot(**s) for s in payload["shots"]],
        video_url=video,
        track_url=urls["track_url"] or "",
        track_bin_url=urls["track_bin_url"] or "",
        thumb_url=urls["thumb_url"],
    )
