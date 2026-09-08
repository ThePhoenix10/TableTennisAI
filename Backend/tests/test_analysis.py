"""Peak decoding, rally grouping, frame-rate gating. No GPU needed.

No GPU, but the module under test imports torch, so this file needs the
`worker` extra. Skipped rather than failing collection, which used to take the
whole suite down on a machine with only the API deps installed.
"""
import numpy as np
import pytest

pytest.importorskip("torch", reason="pip install -e '.[worker]'")

from pongai.worker.stages.analysis import decode_peaks, group_rallies, kinematics
from pongai.worker.stages.geometry import PRE_FRAMES, WINDOW_FRAMES


def curve(n, peaks, w=3.0):
    p = np.zeros(n)
    t = np.arange(n)
    for pk in peaks:
        p = np.maximum(p, 0.9 * np.exp(-((t - pk) ** 2) / (2 * w ** 2)))
    return p


@pytest.mark.parametrize("peaks,expected", [
    ([100, 250, 400], 3),
    ([100, 112], 1),        # closer than the 0.25s NMS gap
    ([100, 140], 2),
    ([], 0),
])
def test_decode_peaks(peaks, expected):
    assert len(decode_peaks(curve(600, peaks) if peaks else np.zeros(600))) == expected


def test_rally_grouping():
    ts, t = [], 0.0
    for n in (5, 3, 6):
        for _ in range(n):
            ts.append(t); t += 1.0
        t += 9.0
    rid, sidx = group_rallies(np.array(ts))
    assert len(set(rid)) == 3
    assert list(sidx[:6]) == [0, 1, 2, 3, 4, 0]


def _window():
    kp = np.zeros((WINDOW_FRAMES, 17, 2), np.float32)
    base = np.array([[0, -1.55], [-.06, -1.6], [.06, -1.6], [-.13, -1.58],
                     [.13, -1.58], [-.34, -1.0], [.34, -1.0], [-.52, -.55],
                     [.52, -.55], [-.62, -.1], [.62, -.1], [-.16, 0], [.16, 0],
                     [-.18, .75], [.18, .75], [-.30, 1.5], [.30, 1.5]], np.float32)
    kp[:] = base
    t = np.arange(WINDOW_FRAMES)
    kp[:, 10, 0] = 0.62 + 1.1 * np.tanh((t - PRE_FRAMES) / 12.)
    kp[:, 10, 1] = -0.1 - 0.7 * np.exp(-((t - PRE_FRAMES) / 10.) ** 2)
    return kp, np.ones((WINDOW_FRAMES, 17)), np.full(WINDOW_FRAMES, 1.8, np.float32)


POSITION = ["backswing_amplitude", "contact_height", "elbow_angle",
            "elbow_range", "trunk_lean", "trunk_rotation", "table_distance",
            "stance_width", "knee_angle"]
VELOCITY = ["peak_wrist_speed", "time_to_peak", "follow_through",
            "recovery_time"]


@pytest.mark.parametrize("fps,velocity_expected", [(120, True), (60, True),
                                                   (30, False), (24, False)])
def test_velocity_gated_by_fps(fps, velocity_expected):
    """At 30fps the wrist-speed peak is ~54% under-measured because it is only
    ~33ms wide. Returning a wrong number is worse than returning none."""
    kp, val, td = _window()
    k = kinematics(kp, val, td, 10, fps)
    assert all(k[f] is not None for f in POSITION)
    assert any(k[f] is not None for f in VELOCITY) == velocity_expected


def test_position_kinematics_identical_across_fps():
    kp, val, td = _window()
    a = kinematics(kp, val, td, 10, 120)
    b = kinematics(kp, val, td, 10, 30)
    for f in POSITION:
        assert abs(a[f] - b[f]) < 1e-9
