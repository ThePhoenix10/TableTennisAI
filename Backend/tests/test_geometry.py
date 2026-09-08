"""Canonicalisation and frame-rate resampling."""
import numpy as np

from pongai.worker.stages.geometry import (
    L_HIP, L_SHO, L_WRI, R_HIP, R_SHO, R_WRI,
    canonicalise, resample_to_grid, torso_scale,
)


def _pose(n=50):
    kp = np.zeros((n, 17, 2), np.float32)
    kp[:, L_SHO] = [480, 300]; kp[:, R_SHO] = [520, 300]
    kp[:, L_HIP] = [485, 460]; kp[:, R_HIP] = [515, 460]
    kp[:, R_WRI] = [620, 380]
    return kp, np.full((n, 17), 0.9, np.float32), np.zeros(n, np.int32)


def test_torso_scale():
    kp, _, _ = _pose()
    assert abs(torso_scale(kp) - 160.0) < 1.0


def test_hip_centred():
    kp, sc, seg = _pose()
    c, _, _ = canonicalise(kp, sc, seg, mirror=False)
    hip = (c[0, L_HIP] + c[0, R_HIP]) / 2
    assert np.abs(hip).max() < 1e-6


def test_mirror_negates_x_and_swaps_joints():
    """A flip must do BOTH. Negating x alone leaves the anatomical labels
    wrong; swapping alone is just a relabel."""
    kp, sc, seg = _pose()
    a, _, _ = canonicalise(kp, sc, seg, mirror=False)
    b, _, _ = canonicalise(kp, sc, seg, mirror=True)
    assert abs(b[0, L_WRI, 0] + a[0, R_WRI, 0]) < 1e-5
    assert abs(b[0, L_WRI, 1] - a[0, R_WRI, 1]) < 1e-5   # y unchanged


def _raw(n, fps):
    return dict(
        frame_idx=np.arange(n, dtype=np.int32),
        seg_id=np.zeros(n, np.int32),
        keypoints=np.random.default_rng(0).normal(500, 50, (n, 2, 17, 2)).astype(np.float32),
        scores=np.full((n, 2, 17), 0.9, np.float32),
        boxes=np.tile(np.array([100, 100, 300, 600], np.float32), (n, 2, 1)),
        detected=np.ones((n, 2), bool))


def test_resample_is_noop_at_grid_fps():
    raw = _raw(600, 120)
    out = resample_to_grid(raw, 120.0)
    assert len(out["frame_idx"]) == 600


def test_resample_upsamples_low_fps():
    for src, factor in ((60.0, 2), (30.0, 4)):
        n = int(10 * src)
        out = resample_to_grid(_raw(n, src), src)
        assert abs(len(out["frame_idx"]) - n * factor) < 5
        assert "src_frame" in out       # needed to map back to real timestamps


def test_velocity_loss_is_real_not_a_bug():
    """Interpolation restores units, not information. Documented so nobody
    'fixes' the 60fps velocity gate by resampling harder."""
    t = np.arange(0, 97)
    pos = np.cumsum(1.6 * np.exp(-((t - 48) / 7.0) ** 2))
    true_peak = np.diff(pos).max()
    at30 = np.diff(np.interp(t, t[::4], pos[::4])).max()
    assert at30 < true_peak * 0.95
