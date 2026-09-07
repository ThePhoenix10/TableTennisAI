"""
pongai.core.progress — weighted stage progress.

The seven pipeline stages take wildly different amounts of time. Reporting
them as equal sevenths would jump to 43%, sit motionless for fifteen minutes
during pose extraction, then jump again — which reads as a hung job.

Weights below are measured from real runs on a T4.
"""
from __future__ import annotations

from dataclasses import dataclass

from pongai.core.schema import Job, JobStage, JobStatus, utcnow

# Share of total wall time. Pose and render dominate; everything else is noise.
STAGE_WEIGHTS: dict[JobStage, float] = {
    JobStage.VALIDATE:      0.01,
    JobStage.ACTIVITY_GATE: 0.04,
    JobStage.POSE:          0.60,   # RTMPose on every active frame
    JobStage.DETECT:        0.01,
    JobStage.CLASSIFY:      0.01,
    JobStage.RENDER:        0.30,   # decode + draw + NVENC encode
    JobStage.UPLOAD:        0.03,
}

STAGE_ORDER: list[JobStage] = [
    JobStage.VALIDATE, JobStage.ACTIVITY_GATE, JobStage.POSE,
    JobStage.DETECT, JobStage.CLASSIFY, JobStage.RENDER, JobStage.UPLOAD,
]

STAGE_LABELS: dict[JobStage, str] = {
    JobStage.VALIDATE:      "Checking the video",
    JobStage.ACTIVITY_GATE: "Finding the rallies",
    JobStage.POSE:          "Tracking body movement",
    JobStage.DETECT:        "Detecting shots",
    JobStage.CLASSIFY:      "Classifying strokes",
    JobStage.RENDER:        "Rendering the analysis",
    JobStage.UPLOAD:        "Saving results",
}

# Wall time ~5x the clip duration on a T4, plus cold start.
REALTIME_FACTOR = 5.0
COLD_START_S = 240.0


def overall_progress(stage: JobStage, within: float) -> float:
    """Weighted progress across the whole job.

    `within` is 0-1 through the current stage. Pose and render should report
    it — they are already looping over frames, so it costs a modulo and a
    table write.
    """
    done = sum(STAGE_WEIGHTS[s] for s in STAGE_ORDER
               if STAGE_ORDER.index(s) < STAGE_ORDER.index(stage))
    return min(1.0, done + STAGE_WEIGHTS[stage] * max(0.0, min(1.0, within)))


def estimate_total_s(duration_s: float, cold: bool = False) -> float:
    return duration_s * REALTIME_FACTOR + (COLD_START_S if cold else 0.0)


def eta_s(progress: float, elapsed_s: float) -> float | None:
    """Remaining time from observed rate. None until there is enough signal —
    an ETA from 2% progress is noise and looks worse than none."""
    if progress < 0.05 or elapsed_s < 20:
        return None
    return max(0.0, elapsed_s / progress - elapsed_s)


@dataclass
class ProgressReporter:
    """Worker-side. Writes job state to Table Storage; the API's SSE endpoint
    polls it. The worker never calls the API.

    Throttled — writing on every frame would hammer the table for no benefit.
    """
    storage: object
    job: Job
    min_interval_s: float = 2.0

    _last_write: float = 0.0
    _started: float = 0.0

    def __post_init__(self) -> None:
        import time
        self._started = time.time()

    def stage(self, stage: JobStage, message: str | None = None) -> None:
        """Entering a new stage. Always written, never throttled."""
        self.job.stage = stage
        self.job.status = JobStatus.PROCESSING
        self.job.progress = overall_progress(stage, 0.0)
        self._flush(force=True)

    def within(self, stage: JobStage, done: int, total: int) -> None:
        """Progress inside a stage, e.g. frames processed."""
        if total <= 0:
            return
        self.job.stage = stage
        self.job.progress = overall_progress(stage, done / total)
        import time
        el = time.time() - self._started
        self.job.eta_s = eta_s(self.job.progress, el)
        self._flush()

    def done(self) -> None:
        self.job.status = JobStatus.DONE
        self.job.progress = 1.0
        self.job.stage = None
        self.job.eta_s = 0.0
        self.job.finished_at = utcnow()
        self._flush(force=True)

    def failed(self, code: str, message: str) -> None:
        self.job.status = JobStatus.FAILED
        self.job.error_code = code
        self.job.error_message = message
        self.job.finished_at = utcnow()
        self._flush(force=True)

    def rejected(self, rejections: list) -> None:
        """Failed validation — not an error. The user gets readable reasons."""
        self.job.status = JobStatus.REJECTED
        self.job.rejections = rejections
        self.job.finished_at = utcnow()
        self._flush(force=True)

    def _flush(self, force: bool = False) -> None:
        import time
        now = time.time()
        if not force and now - self._last_write < self.min_interval_s:
            return
        self._last_write = now
        self.storage.put_job(self.job)
