"""
pongai.worker.run — the GPU job.

Runs as an Azure Container Apps JOB, not an App: queue-triggered, processes
one message, exits. No HTTP server, no health probe, no idle replica.

    docker run pongai-worker            # picks up one message and exits
    python -m pongai.worker.run

The worker never calls the API. It reads the queue and writes job state to
Table Storage; the API's SSE endpoint polls that table. So the API can restart
mid-job with no effect.
"""
from __future__ import annotations

import logging
import os
import sys
import tempfile
import traceback
from pathlib import Path

from pongai.core.progress import ProgressReporter
from pongai.core.schema import JobStage, JobStatus, utcnow
from pongai.core.storage import OUTPUTS_CONTAINER, UPLOADS_CONTAINER, get_storage
from pongai.core.validation import blocking, is_acceptable, validate_file

log = logging.getLogger("pongai.worker")

MAX_MESSAGES = int(os.getenv("MAX_MESSAGES", "1"))   # Jobs process one and exit
VISIBILITY_S = int(os.getenv("VISIBILITY_TIMEOUT", "3600"))


def process(job_id: str) -> None:
    store = get_storage()
    job = store.get_job(job_id)
    if not job:
        log.error("job %s not found", job_id)
        return
    if job.is_terminal:
        log.info("job %s already %s, skipping", job_id, job.status.value)
        return

    job.status = JobStatus.VALIDATING
    job.started_at = utcnow()
    rep = ProgressReporter(storage=store, job=job)
    rep.stage(JobStage.VALIDATE)

    workdir = Path(tempfile.mkdtemp(prefix=f"pongai_{job_id}_"))
    try:
        # --- fetch ----------------------------------------------------------
        src = workdir / (job.filename or "input.mp4")
        store.download(UPLOADS_CONTAINER, f"{job_id}/{job.filename}", str(src))
        log.info("job %s: downloaded %.1f MB", job_id, src.stat().st_size / 1e6)

        # --- authoritative validation ---------------------------------------
        # The API only saw what the client claimed. Re-probe the real file —
        # this costs seconds and prevents ~30 minutes of GPU on a bad input.
        probe, rejections = validate_file(src)
        job.probe = probe
        if not is_acceptable(rejections):
            log.info("job %s rejected: %s", job_id,
                     [r.code for r in blocking(rejections)])
            rep.rejected(rejections)
            return

        # --- geometry: is this even the right kind of footage? --------------
        # Catches a phone video from a tournament hall with six tables and
        # dozens of spectators, or a 45-degree angle where both players land
        # on the same side of frame. Seconds of CPU, saves the whole GPU run.
        from pongai.worker.pipeline import load_detector
        from pongai.core.validation import validate_geometry

        geo = validate_geometry(load_detector(), src)
        if geo.rejections:
            log.info("job %s rejected on geometry: table %.0f%%, opposed %.0f%%",
                     job_id, geo.table_found_pct * 100, geo.players_opposed_pct * 100)
            rep.rejected(geo.rejections)
            return

        # --- the pipeline ---------------------------------------------------
        from pongai.worker.pipeline import analyse

        result = analyse(
            video_path=src,
            workdir=workdir,
            source_fps=probe.fps,
            on_stage=rep.stage,
            on_progress=rep.within,
        )

        # --- publish --------------------------------------------------------
        rep.stage(JobStage.UPLOAD)
        for name, local, ctype in (
            ("shots.json",  result.shots_json,  "application/json"),
            ("track.json",  result.track_json,  "application/json"),
            ("track.bin",   result.track_bin,   "application/octet-stream"),
            ("video.mp4",   result.video,       "video/mp4"),
            ("thumb.jpg",   result.thumb,       "image/jpeg"),
        ):
            if local and Path(local).exists():
                store.upload(OUTPUTS_CONTAINER, f"{job_id}/{name}",
                             str(local), content_type=ctype)

        rep.done()
        log.info("job %s done: %d shots, %d rallies",
                 job_id, result.n_shots, result.n_rallies)

    except Exception as e:
        log.exception("job %s failed", job_id)
        rep.failed(code=type(e).__name__, message=str(e)[:500])
        raise
    finally:
        import shutil
        shutil.rmtree(workdir, ignore_errors=True)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s")

    # A job id can be passed directly, which makes local testing trivial:
    #   python -m pongai.worker.run <job_id>
    if len(sys.argv) > 1:
        process(sys.argv[1])
        return 0

    store = get_storage()
    queue = store._queue()

    msgs = queue.receive_messages(
        messages_per_page=MAX_MESSAGES, visibility_timeout=VISIBILITY_S)
    handled = 0
    for m in msgs:
        job_id = m.content
        log.info("picked up job %s (dequeue #%d)", job_id, m.dequeue_count)
        try:
            process(job_id)
            queue.delete_message(m)
        except Exception:
            # Leave it on the queue. After a few failed attempts Azure moves it
            # to the poison queue rather than retrying forever.
            log.error("job %s left on queue for retry\n%s",
                      job_id, traceback.format_exc())
        handled += 1
        if handled >= MAX_MESSAGES:
            break

    if handled == 0:
        log.info("queue empty, exiting")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
