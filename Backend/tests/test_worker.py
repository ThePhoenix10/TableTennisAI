"""Worker fixes: crash paths, artifact validity, exact chunking.

Pure numpy/torch — no GPU, no video files.
"""
import json

import numpy as np
import pytest

torch = pytest.importorskip("torch", reason="pip install -e '.[worker]'")
pytest.importorskip("cv2", reason="pip install -e '.[worker]'")

from pongai.core.schema import CONTACT_INDEX, GRID_FPS, WINDOW_FRAMES
from pongai.worker.stages import analysis as A
from pongai.worker.stages import geometry as G
from pongai.worker.stages import video as V
from pongai.worker.stages.nets import DetNet


# =============================================================================
# Window geometry has one owner
# =============================================================================

def test_window_constants_come_from_core():
    assert (G.WINDOW_FRAMES, G.GRID_FPS) == (WINDOW_FRAMES, GRID_FPS)
    assert G.PRE_FRAMES == CONTACT_INDEX
    # and still match the trained checkpoints
    assert (G.PRE_FRAMES, G.POST_FRAMES, G.WINDOW_FRAMES) == (60, 36, 97)


# =============================================================================
# render(): CAP_PROP_FRAME_COUNT is not a bound
# =============================================================================

def _lut(reported_n, frame_idx):
    """The sizing render() does before drawing skeletons."""
    lut_n = max(reported_n, int(frame_idx.max()) + 1) if len(frame_idx) else reported_n
    lut = np.full(lut_n, -1, np.int32)
    lut[frame_idx] = np.arange(len(frame_idx))
    return lut


def test_lut_survives_a_decoder_that_yields_more_than_reported():
    """Some containers under-report frame count; this used to IndexError at
    the render stage, after ~90% of the wall time."""
    lut = _lut(100, np.arange(105))
    assert len(lut) == 105 and lut[104] == 104


def test_lut_handles_a_short_pose_pass():
    lut = _lut(100, np.array([0, 5, 6]))
    assert len(lut) == 100 and lut[5] == 1 and lut[1] == -1


# =============================================================================
# build_crop_track(): degrade rather than discard the run
# =============================================================================

def _raw(n=50, detect_left=True):
    frame_idx = np.arange(n)
    boxes = np.zeros((n, 2, 4), np.float32)
    detected = np.zeros((n, 2), bool)
    boxes[:, 0] = [100, 100, 200, 400]
    detected[:, 0] = detect_left
    boxes[:, 1] = [800, 100, 900, 400]
    detected[:, 1] = True
    return {"frame_idx": frame_idx, "boxes": boxes, "detected": detected}


def test_undetected_player_yields_a_static_crop_not_an_exception():
    """A player occluded throughout used to raise at the render stage,
    throwing away a finished pose pass, classification and encode."""
    cx, cy, cw, ch, pct = V.build_crop_track(
        _raw(detect_left=False), 0, 1920, 1080, out_scale=1.0, n_frames=50)
    assert pct == 0.0
    assert len(cx) == 50 and np.all(cx == 960)      # centred
    assert np.isfinite([cw, ch]).all()


def test_detected_player_is_unaffected():
    cx, cy, cw, ch, pct = V.build_crop_track(
        _raw(), 0, 1920, 1080, out_scale=1.0, n_frames=50)
    assert pct == 1.0 and len(cx) == 50


# =============================================================================
# shots.json must be parseable JSON
# =============================================================================

def test_a_nan_kinematic_fails_at_write_not_at_read():
    """Python writes a bare `NaN` literal, which no JSON parser accepts. The
    API renders with allow_nan=False, so a poisoned file meant the job was
    marked DONE and then answered 500 forever."""
    poisoned = {"shots": [{"backswing_amplitude": float("nan")}]}
    assert json.dumps(poisoned) == '{"shots": [{"backswing_amplitude": NaN}]}'
    with pytest.raises(ValueError, match="not JSON compliant"):
        json.dumps(poisoned, allow_nan=False)


def test_build_stream_sanitises_keypoints():
    """`kp` feeds the kinematics; a NaN there reaches shots.json."""
    n = 20
    raw = {
        "seg_id": np.zeros(n, np.int32),
        "keypoints": np.full((n, 2, 17, 2), np.nan, np.float32),
        "scores": np.ones((n, 2, 17), np.float32),
        "detected": np.ones((n, 2), bool),
        "frame_idx": np.arange(n, dtype=np.int32),
    }
    st = G.build_stream(raw, table=None)
    assert np.isfinite(st["kp"]).all()
    assert np.isfinite(st["X"]).all()
    assert np.isfinite(st["td"]).all()


# =============================================================================
# Chunked detection is exact, not approximate
# =============================================================================

@pytest.mark.parametrize("T", [1000, A.DET_CHUNK, A.DET_CHUNK + 1, 40000])
def test_det_windows_cover_every_frame_exactly_once(T):
    kept = np.concatenate([np.arange(k0, k1)
                           for _, _, k0, k1 in A._det_windows(0, T)])
    assert np.array_equal(kept, np.arange(T))


def test_det_windows_do_not_chunk_short_spans():
    assert list(A._det_windows(0, 1000)) == [(0, 1000, 0, 1000)]


def test_chunked_detection_matches_a_single_pass():
    """Margins exceed the 2,033-frame receptive field, and BatchNorm is in
    eval mode, so the split must not change a single output."""
    torch.manual_seed(0)
    np.random.seed(0)
    C, T = 170, 40000
    net = DetNet(C).eval()
    X = np.random.randn(T, C).astype(np.float32)
    mu, sd = X.mean(0), X.std(0) + 1e-6

    with torch.no_grad():
        x = torch.tensor(((X - mu) / sd).T[None], dtype=torch.float32)
        lc, ls = net(x)
        ref_p = torch.sigmoid(lc)[0].numpy()
        ref_s = torch.sigmoid(ls)[0].numpy()

    got_p, got_s = A.detect_contacts(
        net, {"X": X, "spans": [(0, T)]}, mu, sd, device="cpu")

    assert np.allclose(ref_p, got_p, atol=1e-6)
    assert np.allclose(ref_s, got_s, atol=1e-6)
    assert np.array_equal(A.decode_peaks(ref_p), A.decode_peaks(got_p))


# =============================================================================
# Rally lengths without pandas
# =============================================================================

def test_rally_lengths_count_correctly():
    from collections import Counter
    ts = np.array([0.0, 1.0, 2.0, 10.0, 11.0])
    rid, sidx = A.group_rallies(ts)
    rlen = Counter(rid.tolist())
    assert [rlen[r] for r in rid] == [3, 3, 3, 2, 2]


# =============================================================================
# Geometry gate — the denominator matters
# =============================================================================

class FakeDetector:
    """Stands in for the YOLO model. `script` gives, per sampled frame, the
    player-box centre x positions; the table is always centred at 960."""
    names = {0: "player", 1: "table"}

    def __init__(self, script):
        self.script = script
        self.i = -1

    def predict(self, _frame, **_kw):
        self.i += 1
        centres = self.script[min(self.i, len(self.script) - 1)]
        boxes = [[860.0, 400.0, 1060.0, 600.0]]      # the table
        cls = [1]
        for cx in centres:
            boxes.append([cx - 40, 300.0, cx + 40, 700.0])
            cls.append(0)
        return [_Result(np.array(boxes, np.float32), np.array(cls))]


class _Boxes:
    def __init__(self, xyxy, cls):
        self.xyxy = _T(xyxy)
        self.cls = _T(cls)

    def __len__(self):
        return len(self.xyxy.v)


class _T:
    def __init__(self, v):
        self.v = v

    def cpu(self):
        return self

    def numpy(self):
        return self.v


class _Result:
    def __init__(self, xyxy, cls):
        self.boxes = _Boxes(xyxy, cls)


def _geometry(script, tmp_path, monkeypatch):
    """Run validate_geometry over a scripted detector, with cv2 stubbed so no
    real video file is needed."""
    from pongai.core import validation as V

    class FakeCap:
        def __init__(self, *_):
            pass

        def get(self, _prop):
            return float(len(script) * 10)

        def set(self, *_):
            return True

        def read(self):
            return True, np.zeros((1080, 1920, 3), np.uint8)

        def release(self):
            pass

    monkeypatch.setattr("cv2.VideoCapture", FakeCap)
    return V.validate_geometry(FakeDetector(script), tmp_path / "x.mp4",
                               n_samples=len(script))


def test_dead_time_does_not_reject_a_well_framed_clip(tmp_path, monkeypatch):
    """The real failure this fixes: a 9s clip where both players share the
    court for under 2s. Opposed across ALL frames is 23%; across frames where
    both were visible it is 100%."""
    script = [[500.0]] * 10 + [[500.0, 1400.0]] * 3 + [[]] * 0
    r = _geometry(script, tmp_path, monkeypatch)
    assert r.frames_with_both == 3
    assert r.players_opposed_pct == 1.0
    assert r.rejections == []


def test_same_side_players_are_still_rejected(tmp_path, monkeypatch):
    """A 45-degree camera angle puts both players on one side of the table."""
    script = [[400.0, 500.0]] * 10
    r = _geometry(script, tmp_path, monkeypatch)
    assert r.frames_with_both == 10
    assert r.players_opposed_pct == 0.0
    assert [x.code.value for x in r.rejections] == ["players_not_opposed"]


def test_never_two_players_is_reported_distinctly(tmp_path, monkeypatch):
    script = [[500.0]] * 10
    r = _geometry(script, tmp_path, monkeypatch)
    assert r.frames_with_both == 0
    assert "never saw two players" in r.rejections[0].message
