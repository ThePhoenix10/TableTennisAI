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

import json
import logging
import os
import sys
import tempfile
import traceback
from pathlib import Path

from pongai.core.config import load_env

load_env()   # before anything reads os.environ

from pongai.core.progress import ProgressReporter  # noqa: E402
from pongai.core.schema import JobStage, utcnow
from pongai.core.storage import OUTPUTS_CONTAINER, UPLOADS_CONTAINER, get_storage
from pongai.core.validation import blocking, is_acceptable, validate_file

log = logging.getLogger("pongai.worker")

MAX_MESSAGES = int(os.getenv("MAX_MESSAGES", "1"))   # Jobs process one and exit

# Must exceed the Container Apps job `--replica-timeout` (3600s in
# infra/deploy.sh). They were equal, so a job running to the wire made its
# queue message visible again at the same moment it was still processing: a
# second replica picked up the same job and ran the whole 25-minute pipeline
# again on the same GPU budget. The replica is killed at REPLICA_TIMEOUT_S, so
# a lease longer than that cannot be outlived.
REPLICA_TIMEOUT_S = int(os.getenv("REPLICA_TIMEOUT", "3600"))
VISIBILITY_S = int(os.getenv("VISIBILITY_TIMEOUT", str(REPLICA_TIMEOUT_S + 300)))


def process(user_id: str, job_id: str) -> None:
    store = get_storage()
    job = store.get_job(user_id, job_id)
    if not job:
        log.error("job %s not found", job_id)
        return
    if job.is_terminal:
        log.info("job %s already %s, skipping", job_id, job.status.value)
        return

    job.started_at = utcnow()
    rep = ProgressReporter(storage=store, job=job)
    rep.stage(JobStage.VALIDATE)          # sets VALIDATING and writes it

    workdir = Path(tempfile.mkdtemp(prefix=f"pongai_{job_id}_"))
    try:
        # --- fetch ----------------------------------------------------------
        # One name for both ends. These were computed separately, so a job
        # with no filename downloaded from ".../None" into "input.mp4".
        filename = job.filename or "input.mp4"
        src = workdir / filename
        store.download(UPLOADS_CONTAINER, f"{job_id}/{filename}", str(src))
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

        # Non-blocking findings from the AUTHORITATIVE probe. The API could
        # only record what the client claimed, and a client that sent no probe
        # at all recorded nothing — so a 30fps upload reached the results page
        # with four empty kinematics and no explanation for them.
        rep.warn(rejections)

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
        # The pipeline raises RuntimeError with text written for a user ("no
        # rally activity found — both players must be visible and moving").
        # Anything else carries internals — temp paths, blob URLs, SDK detail
        # — and error_message is streamed straight to the browser, so it gets
        # a generic line and the specifics stay in the log above.
        message = (str(e)[:500] if isinstance(e, RuntimeError)
                   else "Analysis failed unexpectedly. Please try again.")
        rep.failed(code=type(e).__name__, message=message)
        raise
    finally:
        import shutil
        shutil.rmtree(workdir, ignore_errors=True)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s")

    # A job can be named directly, which makes local testing trivial:
    #   python -m pongai.worker.run <user_id> <job_id>
    if len(sys.argv) > 2:
        process(sys.argv[1], sys.argv[2])
        return 0
    if len(sys.argv) > 1:
        log.error("a job is now addressed by owner: "
                  "python -m pongai.worker.run <user_id> <job_id>")
        return 2

    store = get_storage()
    msgs = store.receive_messages(MAX_MESSAGES, VISIBILITY_S)
    handled = 0
    for m in msgs:
        # The message carries the owner as well as the job: the table is
        # partitioned by user, so a job id alone no longer locates the row.
        try:
            msg = json.loads(m.content)
            user_id, job_id = msg["u"], msg["j"]
        except (ValueError, KeyError, TypeError):
            log.error("unreadable queue message, discarding: %r",
                      m.content[:200])
            store.delete_message(m)
            continue

        log.info("picked up job %s (dequeue #%d)", job_id, m.dequeue_count)
        try:
            process(user_id, job_id)
        except Exception:
            # The job row is already FAILED and carries the reason; retrying is
            # explicit, via POST /api/jobs/{id}/retry, which enqueues a fresh
            # message. So this one is finished either way.
            #
            # Leaving it queued instead (the old behaviour) was worse in both
            # directions: Azure Storage Queues have no poison-queue handling of
            # their own — that is the Functions/WebJobs SDK — so the message
            # would redeliver until its 7-day TTL, and every redelivery hit the
            # `is_terminal` guard in process() and did nothing. Worse, once a
            # user retried, the stale message could reappear alongside the new
            # one and run the same job twice at once.
            #
            # A worker that dies before writing FAILED never reaches this line,
            # so its message stays invisible, reappears, and is reprocessed —
            # which is the automatic recovery we do want, for infrastructure
            # failures rather than analysis failures.
            log.error("job %s failed; message removed, retry is explicit\n%s",
                      job_id, traceback.format_exc())
        finally:
            store.delete_message(m)
        handled += 1
        if handled >= MAX_MESSAGES:
            break

    if handled == 0:
        log.info("queue empty, exiting")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
