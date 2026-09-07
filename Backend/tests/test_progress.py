"""Weighted stage progress."""
from pongai.core.progress import (
    STAGE_ORDER, STAGE_WEIGHTS, eta_s, overall_progress,
)


def test_weights_sum_to_one():
    assert abs(sum(STAGE_WEIGHTS.values()) - 1.0) < 1e-9


def test_every_stage_weighted():
    assert set(STAGE_ORDER) == set(STAGE_WEIGHTS)


def test_monotonic():
    pts = [overall_progress(s, w)
           for s in STAGE_ORDER for w in (0.0, 0.5, 1.0)]
    assert all(b >= a - 1e-9 for a, b in zip(pts, pts[1:]))
    assert abs(pts[-1] - 1.0) < 1e-9


def test_pose_and_render_dominate():
    """They are ~90% of wall time, which is why they must report within-stage
    progress or the bar sits still for 15 minutes and reads as hung."""
    from pongai.core.schema import JobStage
    assert STAGE_WEIGHTS[JobStage.POSE] + STAGE_WEIGHTS[JobStage.RENDER] >= 0.85


def test_eta_suppressed_early():
    """An ETA from 2% progress is noise and looks worse than none."""
    assert eta_s(0.02, 5) is None
    assert eta_s(0.50, 600) is not None
