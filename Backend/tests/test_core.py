"""Core contract: one owner per constant, warning severity, job persistence.

Pure — no Azure, no GPU.
"""
import json

import pytest

from pongai.core.progress import ProgressReporter
from pongai.core.schema import (
    MIN_FPS_FOR_VELOCITY, Job, JobStage, JobStatus, ShotClass, model_payload,
    utcnow,
)
from pongai.core.storage import is_job_id
from pongai.core.validation import (
    Limits, Rejection, RejectionCode, Severity, VideoProbe, limits_payload,
    validate_probe,
)


def probe(**kw):
    d = dict(size_bytes=50_000_000, duration_s=180, width=1920, height=1080,
             fps=120, codec="h264", n_frames=21600)
    return VideoProbe(**{**d, **kw})


# =============================================================================
# One owner per constant
# =============================================================================

def test_velocity_threshold_has_a_single_source():
    """It was written out four times across the two modules whose entire
    purpose is to stop a number being written out twice."""
    assert (Limits.MIN_FPS_FOR_VELOCITY
            == MIN_FPS_FOR_VELOCITY
            == limits_payload()["velocity_min_fps"] == 60)


def test_limits_response_states_the_threshold_once():
    payload = {**limits_payload(), "model": model_payload()}
    keys = [k for k, v in payload.items() if v == 60]
    assert keys == ["velocity_min_fps"]
    assert "min_fps_for_velocity" not in payload["model"]


def test_probe_serializes_the_velocity_gate():
    assert probe(fps=120).model_dump()["velocity_reliable"] is True
    assert probe(fps=30).model_dump()["velocity_reliable"] is False


def test_class_order_matches_the_trained_checkpoint():
    """ShotClass order is load-bearing: the worker builds its logit-index ->
    label list from it, and /limits publishes the same order to the frontend.
    Reordering the enum would relabel every shot with nothing failing, so it
    fails here instead.

    No worker import — this holds whether or not torch is installed.
    """
    assert [c.value for c in ShotClass] == [
        "serve", "attack", "control", "defence"]
    assert model_payload()["shot_classes"] == [c.value for c in ShotClass]


def test_worker_derives_its_labels_rather_than_retyping_them():
    """Guards against a literal list reappearing beside the enum."""
    pytest.importorskip("torch", reason="worker extra not installed")
    from pongai.worker.stages import analysis          # noqa: PLC0415
    assert analysis.CLASSES == [c.value for c in ShotClass]


# =============================================================================
# Warnings are not rejections
# =============================================================================

def test_velocity_warning_has_its_own_code():
    """Sharing FPS_TOO_LOW made 'we cannot process this' and 'we will process
    it without swing speed' indistinguishable to a client keying on code."""
    warn = [r for r in validate_probe(probe(fps=30))
            if r.severity == Severity.WARN]
    assert len(warn) == 1
    assert warn[0].code == RejectionCode.VELOCITY_UNAVAILABLE

    reject = [r for r in validate_probe(probe(fps=24))
              if r.severity == Severity.REJECT]
    assert RejectionCode.FPS_TOO_LOW in {r.code for r in reject}


class FakeStore:
    def __init__(self):
        self.written = []

    def put_job(self, job):
        # round-trip as Table Storage does
        self.written.append(Job.model_validate(
            json.loads(json.dumps(job.model_dump(mode="json")))))


@pytest.fixture
def rep():
    job = Job(job_id="0" * 16, user_id="u0000000000000000000000000000000", status=JobStatus.QUEUED,
              created_at=utcnow(), updated_at=utcnow())
    return ProgressReporter(storage=FakeStore(), job=job)


def test_worker_warnings_are_recorded_without_blocking(rep):
    """The authoritative ffprobe result, not the browser's advisory one."""
    rep.warn(validate_probe(probe(fps=30, source="ffprobe")))
    assert rep.job.status == JobStatus.QUEUED          # still processing
    assert len(rep.job.warnings) == 1
    assert rep.job.warnings[0].code == RejectionCode.VELOCITY_UNAVAILABLE
    assert rep.storage.written[-1].warnings == rep.job.warnings


def test_warn_is_a_no_op_when_everything_is_clean(rep):
    rep.warn(validate_probe(probe(fps=120)))
    assert rep.job.warnings == [] and rep.storage.written == []


def test_rejected_splits_blocking_from_warnings(rep):
    """A 24fps vertical clip carries both. Listing the warning among the
    blocking reasons tells the user their video was refused for something
    that does not refuse it."""
    rej = validate_probe(probe(fps=30, width=1080, height=1920))
    rep.rejected(rej)
    assert rep.job.status == JobStatus.REJECTED
    assert {r.code for r in rep.job.rejections} == {
        RejectionCode.ASPECT_VERTICAL}
    assert {r.code for r in rep.job.warnings} == {
        RejectionCode.VELOCITY_UNAVAILABLE}


def test_reporter_records_failure_and_completion(rep):
    rep.stage(JobStage.POSE)
    assert rep.job.status == JobStatus.PROCESSING
    rep.failed("RuntimeError", "no rally activity found")
    assert rep.job.status == JobStatus.FAILED
    assert rep.job.is_terminal and rep.job.finished_at is not None


# =============================================================================
# Job ids — the guard sits in core because the worker never passes a route
# =============================================================================

@pytest.mark.parametrize("value,ok", [
    ("0123456789abcdef", True),
    ("ABCDEF0123456789", False),      # uppercase is not what new_job_id emits
    ("x' or RowKey ne '", False),     # would rewrite the OData filter
    ("0123456789abcde", False),
    ("0123456789abcdef0", False),
    ("", False),
])
def test_is_job_id(value, ok):
    assert is_job_id(value) is ok


def test_generated_ids_pass_their_own_guard():
    import uuid
    assert is_job_id(uuid.uuid4().hex[:16])


def test_job_survives_the_table_storage_round_trip():
    """Everything persists as one JSON string, so a field that cannot
    serialize is only discovered on read."""
    job = Job(job_id="0" * 16, user_id="u0000000000000000000000000000000", status=JobStatus.PROCESSING,
              created_at=utcnow(), updated_at=utcnow(),
              stage=JobStage.POSE, progress=0.42,
              client_probe=probe(fps=30),
              warnings=[Rejection(code=RejectionCode.VELOCITY_UNAVAILABLE,
                                  severity=Severity.WARN, message="slow")])
    back = Job.model_validate(json.loads(json.dumps(job.model_dump(mode="json"))))
    assert back.progress == 0.42
    assert back.stage == JobStage.POSE
    assert back.client_probe.fps == 30
    assert back.warnings[0].severity == Severity.WARN
    assert back.is_terminal is False


def test_validate_stage_persists_a_validating_status(rep):
    """The worker set VALIDATING and stage() overwrote it with PROCESSING
    before the first write, so it never reached the table and the API's
    message branch for it was unreachable."""
    rep.stage(JobStage.VALIDATE)
    assert rep.job.status == JobStatus.VALIDATING
    assert rep.storage.written[-1].status == JobStatus.VALIDATING

    rep.stage(JobStage.POSE)
    assert rep.storage.written[-1].status == JobStatus.PROCESSING


def test_a_retried_job_gets_past_the_workers_terminal_guard():
    """process() returns early on a terminal job. If reset_for_retry left the
    status terminal, the worker would silently skip every retry."""
    job = Job(job_id="0" * 16, user_id="u0000000000000000000000000000000", status=JobStatus.FAILED, attempts=1,
              created_at=utcnow(), updated_at=utcnow())
    assert job.is_terminal is True
    job.reset_for_retry()
    assert job.is_terminal is False
    assert job.can_retry is False       # queued, so not offerable again yet


def test_stage_label_is_served_with_the_job():
    """A polling client shows the same wording as the SSE stream without
    keeping its own copy of the seven labels."""
    from pongai.core.schema import STAGE_LABELS

    job = Job(job_id="0" * 16, user_id="u0000000000000000000000000000000", status=JobStatus.PROCESSING,
              created_at=utcnow(), updated_at=utcnow(), stage=JobStage.POSE)
    assert job.model_dump()["stage_label"] == "Tracking body movement"

    # every stage has one, so the UI never renders a blank
    assert set(STAGE_LABELS) == set(JobStage)


def test_stage_label_is_null_when_no_stage_is_running():
    job = Job(job_id="0" * 16, user_id="u0000000000000000000000000000000", status=JobStatus.QUEUED,
              created_at=utcnow(), updated_at=utcnow())
    assert job.model_dump()["stage_label"] is None


def test_progress_is_weighted_not_evenly_split():
    """Equal sevenths would jump to 43% then sit still through pose, which
    reads as a hung job."""
    from pongai.core.progress import overall_progress

    assert overall_progress(JobStage.POSE, 0.0) == pytest.approx(0.05)
    assert overall_progress(JobStage.POSE, 1.0) == pytest.approx(0.65)
    assert overall_progress(JobStage.UPLOAD, 1.0) == pytest.approx(1.0)
    # Never goes backwards across the whole run — a progress bar that
    # retreats reads as a fault. Compared with a tolerance because the stage
    # boundaries land on float noise (0.05 vs 0.05000000000000001), which is
    # invisible to a user but not to `sorted`.
    seq = [overall_progress(s, f)
           for s in (JobStage.VALIDATE, JobStage.ACTIVITY_GATE, JobStage.POSE,
                     JobStage.DETECT, JobStage.CLASSIFY, JobStage.RENDER,
                     JobStage.UPLOAD)
           for f in (0.0, 0.5, 1.0)]
    assert all(b >= a - 1e-9 for a, b in zip(seq, seq[1:]))
