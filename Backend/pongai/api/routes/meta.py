"""Endpoints 1, 8, 9 — health, limits, demos."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from pongai.api.deps import storage
from pongai.core.schema import utcnow
from pongai.core.storage import DEMOS_CONTAINER, Storage
from pongai.core.validation import limits_payload

log = logging.getLogger(__name__)
router = APIRouter(tags=["meta"])


@router.get("/health")
def health() -> dict:
    """Container Apps liveness probe. Deliberately does not touch storage —
    a transient storage blip should not restart the container."""
    return {"status": "ok", "time": utcnow().isoformat()}


@router.get("/ready")
def ready(store: Storage = Depends(storage)) -> dict:
    """Readiness. This one does check storage."""
    try:
        depth = store.queue_depth()
        return {"status": "ready", "queue_depth": depth}
    except Exception as e:
        raise HTTPException(503, f"storage unreachable: {e}")


@router.get("/limits")
def limits() -> dict:
    """Served so the browser validates against the same numbers the worker
    enforces. A hardcoded copy in the frontend would drift, producing the
    confusing case where the browser accepts what the worker rejects."""
    return limits_payload()


@router.get("/demos")
def demos(store: Storage = Depends(storage)) -> list[dict]:
    """Precomputed matches. Goes through the API rather than static frontend
    files so demo and real analyses share one code path."""
    try:
        index = store.read_json(DEMOS_CONTAINER, "index.json")
    except Exception:
        log.warning("no demo index found")
        return []

    out = []
    for d in index.get("demos", []):
        vid = d["id"]
        out.append({
            **d,
            "video_url": d.get("video_url") or store.read_sas(
                DEMOS_CONTAINER, f"{vid}/video.mp4"),
            "track_url": store.read_sas(DEMOS_CONTAINER, f"{vid}/track.json"),
            "track_bin_url": store.read_sas(DEMOS_CONTAINER, f"{vid}/track.bin"),
            "thumb_url": store.read_sas(DEMOS_CONTAINER, f"{vid}/thumb.jpg"),
            "analysis_url": f"/api/demos/{vid}",
        })
    return out


@router.get("/demos/{demo_id}")
def demo(demo_id: str, store: Storage = Depends(storage)) -> dict:
    """One demo, in the same shape as GET /analyses/{id}."""
    try:
        payload = store.read_json(DEMOS_CONTAINER, f"{demo_id}/shots.json")
    except Exception:
        raise HTTPException(404, f"demo {demo_id} not found")

    return {
        "meta": payload["meta"],
        "shots": payload["shots"],
        "video_url": payload.get("video_url") or store.read_sas(
            DEMOS_CONTAINER, f"{demo_id}/video.mp4"),
        "track_url": store.read_sas(DEMOS_CONTAINER, f"{demo_id}/track.json"),
        "track_bin_url": store.read_sas(DEMOS_CONTAINER, f"{demo_id}/track.bin"),
        "thumb_url": store.read_sas(DEMOS_CONTAINER, f"{demo_id}/thumb.jpg"),
        "is_demo": True,
    }
