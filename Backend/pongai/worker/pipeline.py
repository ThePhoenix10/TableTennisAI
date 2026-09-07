"""
pongai.worker.pipeline — video in, analysis artifacts out.

Ported from 12_demo_export / 12_pipeline_final. Nine stages:

    activity gate -> pose -> resample -> canonicalise -> contact detection
    -> side attribution -> classification -> kinematics -> rally grouping
    -> render + crop track

Weights are baked into the image at pongai/worker/weights/ (~115 MB). Do NOT
download them at runtime: the job scales to zero, so every cold start would
pay for it, and an upstream URL change would break production.
"""
from __future__ import annotations

import functools
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
import torch

from pongai.core.schema import JobStage
from pongai.worker.stages import analysis as A
from pongai.worker.stages import video as V
from pongai.worker.stages.geometry import (
    GRID_FPS, build_stream, resample_to_grid,
)

log = logging.getLogger(__name__)
WEIGHTS = Path(__file__).parent / "weights"

StageFn = Callable[[JobStage], None]
ProgressFn = Callable[[JobStage, int, int], None]


@dataclass
class AnalysisResult:
    shots_json: Path
    track_json: Path
    track_bin: Path
    video: Path
    thumb: Path | None
    n_shots: int
    n_rallies: int
    source_fps: float


# =============================================================================
# Models — cached so a warm container reuses them
# =============================================================================

@functools.lru_cache(maxsize=1)
def load_detector():
    from ultralytics import YOLO
    m = YOLO(str(WEIGHTS / "best.pt"))
    m.to("cuda")
    return m


@functools.lru_cache(maxsize=1)
def load_pose():
    from rtmlib import RTMPose
    return RTMPose(onnx_model=str(WEIGHTS / "rtmpose-l.onnx"),
                   model_input_size=(288, 384),
                   backend="onnxruntime", device="cuda")


@functools.lru_cache(maxsize=1)
def load_nets():
    from pongai.worker.stages.nets import ClsNet, DetNet
    d = torch.load(WEIGHTS / "detector_final.pt", map_location="cuda",
                   weights_only=False)
    c = torch.load(WEIGHTS / "classifier_final.pt", map_location="cuda",
                   weights_only=False)
    det = DetNet(d["c_in"]).cuda(); det.load_state_dict(d["state"]); det.eval()
    cls = ClsNet(c["c_in"]).cuda(); cls.load_state_dict(c["state"]); cls.eval()
    return det, cls, d["mu"], d["sd"], c["mu"].cuda(), c["sd"].cuda()


@functools.lru_cache(maxsize=1)
def load_calibration() -> dict:
    return json.loads((WEIGHTS / "calibration.json").read_text())


def _class_ids(detector):
    p = next((k for k, v in detector.names.items() if v.lower() == "player"), 0)
    t = next((k for k, v in detector.names.items() if v.lower() == "table"), 1)
    return p, t


# =============================================================================

def analyse(video_path: Path, workdir: Path, source_fps: float,
            on_stage: StageFn | None = None,
            on_progress: ProgressFn | None = None) -> AnalysisResult:
    stage = on_stage or (lambda s: None)
    prog = on_progress or (lambda s, d, t: None)
    t0 = time.time()

    detector = load_detector()
    pose = load_pose()
    det_net, cls_net, dmu, dsd, cmu, csd = load_nets()
    cal = load_calibration()
    temperature = cal["temperature"]
    thresholds = cal.get("per_class_thresholds",
                         {"serve": 0.25, "attack": 0.50,
                          "control": 1.01, "defence": 1.01})
    player_cls, table_cls = _class_ids(detector)

    cap = cv2.VideoCapture(str(video_path))
    nfr = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    table = V.find_table(detector, cap, nfr, table_cls)
    cap.release()
    mid_x = (table[0] + table[2]) / 2 if table is not None else src_w / 2
    log.info("source %dx%d @ %.0ffps, %d frames", src_w, src_h, source_fps, nfr)

    # --- 1. activity gate ---------------------------------------------------
    stage(JobStage.ACTIVITY_GATE)
    spans = V.activity_gate(detector, video_path, nfr, mid_x, source_fps,
                            player_cls,
                            on_progress=lambda d, t: prog(JobStage.ACTIVITY_GATE, d, t))
    covered = sum(e - s + 1 for s, e in spans)
    log.info("active: %d regions, %.0f%% of video", len(spans), 100 * covered / max(nfr, 1))
    if not spans:
        raise RuntimeError("no rally activity found — both players must be "
                           "visible and moving")

    # --- 2. pose ------------------------------------------------------------
    stage(JobStage.POSE)
    raw = V.extract_pose(detector, pose, video_path, spans, mid_x, source_fps,
                         player_cls,
                         on_progress=lambda d, t: prog(JobStage.POSE, d, t))

    # --- 3. resample to the 120fps grid the models were trained on ----------
    # Positions are interpolated and velocity differenced AFTER. Computing
    # velocity at native fps and rescaling gives a different, wrong answer.
    grid = resample_to_grid(raw, source_fps, GRID_FPS)
    if abs(source_fps - GRID_FPS) > 0.5:
        log.info("resampled %d -> %d frames for the %dfps grid",
                 len(raw["frame_idx"]), len(grid["frame_idx"]), GRID_FPS)

    st = build_stream(grid, table)

    # --- 4-5. contact detection + side --------------------------------------
    stage(JobStage.DETECT)
    prob, sidep = A.detect_contacts(det_net, st, dmu, dsd)
    peaks = A.decode_peaks(prob)
    if not len(peaks):
        raise RuntimeError("no shots detected — check the camera angle and "
                           "that both players are in frame")
    sides = ["right" if sidep[i] >= 0.5 else "left" for i in peaks]
    log.info("contacts: %d (%d left, %d right)",
             len(peaks), sides.count("left"), sides.count("right"))

    # --- 6-8. classify, kinematics, rallies ---------------------------------
    stage(JobStage.CLASSIFY)
    pr, pt, kps, vals, sels = A.classify(
        cls_net, st, peaks, sides, cmu, csd, temperature)
    shots = A.build_shots(peaks, sides, pr, pt, kps, vals, sels, st,
                          source_fps, thresholds, prob)
    n_rallies = len({s["rally_id"] for s in shots})
    log.info("%d shots, %d rallies, %d suppressed",
             len(shots), n_rallies, sum(s["abstain"] for s in shots))

    # --- 9. render + crop track ---------------------------------------------
    stage(JobStage.RENDER)
    video_out = workdir / "video.mp4"
    out_w, out_h, written, out_scale = V.render(
        video_path, raw, video_out, source_fps,
        on_progress=lambda d, t: prog(JobStage.RENDER, d, t))

    # Crop track in OUTPUT pixel space, already smoothed and clamped, so the
    # frontend applies it directly. Baking per-player videos instead would be
    # three encodes and ~3x the size for the same result.
    track = {"fps": round(source_fps, 3), "n_frames": written,
             "video_w": out_w, "video_h": out_h, "scale": 10, "stride": 4,
             "layout": ["left_cx", "left_cy", "right_cx", "right_cy"],
             "dtype": "int16", "players": {}}
    arr = np.zeros((written, 4), np.int16)
    assert max(out_w, out_h) * 10 < 32767, "output too large for int16 track"

    for k, (pi, side) in enumerate(((0, "left"), (1, "right"))):
        cx, cy, cw, ch, det_pct = V.build_crop_track(
            raw, pi, src_w, src_h, out_scale, n_frames=nfr)
        arr[:, k * 2] = (cx[:written] * 10).round().astype(np.int16)
        arr[:, k * 2 + 1] = (cy[:written] * 10).round().astype(np.int16)
        track["players"][side] = {"crop_w": round(cw, 1),
                                  "crop_h": round(ch, 1),
                                  "detected_pct": round(float(det_pct), 3)}

    track_bin = workdir / "track.bin"
    arr.tofile(track_bin)
    track_json = workdir / "track.json"
    track_json.write_text(json.dumps(track))

    # --- thumbnail from the longest rally -----------------------------------
    thumb = None
    if shots:
        counts: dict[int, int] = {}
        for s in shots:
            counts[s["rally_id"]] = counts.get(s["rally_id"], 0) + 1
        best = max(counts, key=counts.get)
        mid = sorted(s["frame"] for s in shots if s["rally_id"] == best)
        cap = cv2.VideoCapture(str(video_out))
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(mid[len(mid) // 2]))
        ok, img = cap.read()
        cap.release()
        if ok:
            thumb = workdir / "thumb.jpg"
            h, w = img.shape[:2]
            cv2.imwrite(str(thumb),
                        cv2.resize(img, (640, int(round(640 * h / w / 2) * 2))),
                        [cv2.IMWRITE_JPEG_QUALITY, 82])

    # --- shots.json ---------------------------------------------------------
    shots_json = workdir / "shots.json"
    shots_json.write_text(json.dumps({
        "meta": {
            "video_id": video_path.stem,
            "duration_s": round(written / source_fps, 3),
            "source_fps": round(source_fps, 2),      # gates velocity in the UI
            "width": out_w, "height": out_h,
            "n_shots": len(shots), "n_rallies": n_rallies,
            "schema_version": 1,
        },
        "shots": shots,
    }))

    log.info("pipeline finished in %.1f min", (time.time() - t0) / 60)
    return AnalysisResult(
        shots_json=shots_json, track_json=track_json, track_bin=track_bin,
        video=video_out, thumb=thumb, n_shots=len(shots),
        n_rallies=n_rallies, source_fps=source_fps)
