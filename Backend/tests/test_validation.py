"""Validation rules. Pure — no Azure, no GPU."""
import pytest
from pongai.core.validation import (
    RejectionCode, Severity, VideoProbe,
    blocking, is_acceptable, validate_probe,
)


def probe(**kw):
    d = dict(size_bytes=50_000_000, duration_s=180, width=1920, height=1080,
             fps=120, codec="h264", n_frames=21600)
    d.update(kw)
    return VideoProbe(**d)


def codes(p):
    return {r.code for r in validate_probe(p)}


def test_good_clip_accepted():
    assert is_acceptable(validate_probe(probe()))


def test_30fps_accepted_with_warning():
    """Detection and classification survive at 30fps (96% class agreement
    measured). Only velocity metrics are withheld."""
    rej = validate_probe(probe(fps=30))
    assert is_acceptable(rej)
    assert not blocking(rej)
    assert any(r.severity == Severity.WARN for r in rej)


@pytest.mark.parametrize("kw,code", [
    (dict(size_bytes=150_000_000), RejectionCode.FILE_TOO_LARGE),
    (dict(duration_s=900),          RejectionCode.TOO_LONG),
    (dict(duration_s=3, n_frames=360), RejectionCode.TOO_SHORT),
    (dict(fps=24),                  RejectionCode.FPS_TOO_LOW),
    (dict(fps=300),                 RejectionCode.FPS_TOO_HIGH),
    (dict(width=320, height=240),   RejectionCode.RESOLUTION_TOO_LOW),
    (dict(width=1080, height=1920), RejectionCode.ASPECT_VERTICAL),
])
def test_rejections(kw, code):
    assert code in codes(probe(**kw))
    assert not is_acceptable(validate_probe(probe(**kw)))


def test_all_problems_reported_at_once():
    """A user with several problems should see them all, not fix one and
    resubmit twice."""
    p = probe(size_bytes=200_000_000, duration_s=900, fps=24,
              width=1080, height=1920)
    got = codes(p)
    assert {RejectionCode.FILE_TOO_LARGE, RejectionCode.TOO_LONG,
            RejectionCode.FPS_TOO_LOW, RejectionCode.ASPECT_VERTICAL} <= got


def test_velocity_reliability_boundary():
    assert not probe(fps=30).velocity_reliable
    assert not probe(fps=59).velocity_reliable
    assert probe(fps=60).velocity_reliable
    assert probe(fps=120).velocity_reliable


def test_gpu_estimate():
    assert probe(duration_s=300).estimated_gpu_seconds == 1500
