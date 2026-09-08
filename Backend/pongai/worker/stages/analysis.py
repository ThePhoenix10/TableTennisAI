"""
pongai.worker.stages.analysis — contact detection, classification, kinematics,
rally grouping.
"""
from __future__ import annotations

import numpy as np
import torch

from pongai.core.schema import CLASS_PRECISION, ShotClass
from pongai.worker.stages.geometry import (
    L_ANK, L_ELB, L_HIP, L_KNE, L_SHO, L_WRI, PRE_FRAMES, R_ANK, R_ELB, R_HIP,
    R_KNE, R_SHO, R_WRI, WINDOW_FRAMES, angle, window_at,
)

CLASSES = ["serve", "attack", "control", "defence"]
TECHS = ["block", "chop", "flick", "lob", "loop", "push", "serve", "smash"]

DET_THR = 0.60
NMS_GAP = 30              # 0.25s — you cannot physically strike twice faster
RALLY_GAP_S = 1.5         # validated against 282 annotated rally endings


def detect_contacts(det_net, st, dmu, dsd, device="cuda"):
    """Per-frame contact probability + side, then peak-picking."""
    prob = np.zeros(len(st["X"]), np.float32)
    side = np.zeros(len(st["X"]), np.float32)
    with torch.no_grad():
        for a, b in st["spans"]:
            x = torch.tensor(((st["X"][a:b] - dmu) / dsd).T[None],
                             dtype=torch.float32, device=device)
            lc, ls = det_net(x)
            prob[a:b] = torch.sigmoid(lc)[0].cpu().numpy()
            side[a:b] = torch.sigmoid(ls)[0].cpu().numpy()
    return prob, side


def decode_peaks(prob, thr=DET_THR, gap=NMS_GAP):
    idx = np.where(prob >= thr)[0]
    if not len(idx):
        return np.array([], int)
    peaks = [i for i in idx
             if prob[i] == prob[max(0, i - gap // 2):i + gap // 2 + 1].max()]
    peaks = sorted(peaks, key=lambda i: -prob[i])
    kept = []
    for p in peaks:
        if all(abs(p - k) >= gap for k in kept):
            kept.append(p)
    return np.array(sorted(kept), int)


def classify(cls_net, st, peaks, sides, cmu, csd, temperature,
             device="cuda"):
    """Temperature-scaled so confidence means what it says.

    The final model trained to a loss of 0.0042 and reported 95.7% mean
    confidence at ~79% accuracy. T was fitted on held-out LOVO predictions.
    """
    wins, kps, vals, sels = [], [], [], []
    for i, s in zip(peaks, sides):
        x, kp, val, sel = window_at(st, i, s)
        wins.append(x); kps.append(kp); vals.append(val); sels.append(sel)

    with torch.no_grad():
        xb = torch.tensor(np.stack(wins), device=device)
        lo, lt = cls_net((xb - cmu) / csd)
        pr = torch.softmax(lo / temperature, 1).cpu().numpy()
        pt = torch.softmax(lt / temperature, 1).cpu().numpy()
    return pr, pt, kps, vals, sels


def kinematics(kp, val, td_win, wri, source_fps):
    """13 scalars from the canonical window.

    Nine are position-derived and valid at any frame rate. Four are
    velocity-derived and are set to None below 60fps: at 30fps the wrist-speed
    peak is ~54% under-measured, because that peak is only ~33ms wide.
    Returning a wrong number would be worse than returning none — the frontend
    would compare it against 120fps references and tell every phone-video user
    their swing is slow.
    """
    velocity_ok = source_fps >= 60

    h = -kp[..., 1]                                  # up-positive
    vel = np.zeros_like(kp)
    vel[1:] = np.diff(kp, axis=0)
    spd = np.linalg.norm(vel, axis=-1)
    spd[~val.astype(bool)] = np.nan

    w = spd[:, wri]
    pre, post = slice(0, PRE_FRAMES), slice(PRE_FRAMES, WINDOW_FRAMES)
    sh, el = (R_SHO, R_ELB) if wri == R_WRI else (L_SHO, L_ELB)
    d_hip = np.linalg.norm(kp[:, wri], axis=-1)
    ea = angle(kp[:, sh], kp[:, el], kp[:, wri])
    trunk = (kp[:, L_SHO] + kp[:, R_SHO]) / 2
    ta = np.degrees(np.arctan2(trunk[:, 0], -trunk[:, 1]))

    out = {
        # position-derived — always valid
        "backswing_amplitude": float(np.nanmax(d_hip[pre])),
        "contact_height": float(h[PRE_FRAMES, wri]
                                - (h[PRE_FRAMES, L_SHO] + h[PRE_FRAMES, R_SHO]) / 2),
        "elbow_angle": float(ea[PRE_FRAMES]),
        "elbow_range": float(np.nanmax(ea) - np.nanmin(ea)),
        "trunk_lean": float(ta[PRE_FRAMES]),
        "trunk_rotation": float(np.nanmax(ta) - np.nanmin(ta)),
        "table_distance": float(td_win[PRE_FRAMES]),
        "stance_width": float(abs(kp[PRE_FRAMES, L_ANK, 0]
                                  - kp[PRE_FRAMES, R_ANK, 0])),
        "knee_angle": float(
            (angle(kp[PRE_FRAMES:PRE_FRAMES + 1, L_HIP],
                   kp[PRE_FRAMES:PRE_FRAMES + 1, L_KNE],
                   kp[PRE_FRAMES:PRE_FRAMES + 1, L_ANK])[0]
             + angle(kp[PRE_FRAMES:PRE_FRAMES + 1, R_HIP],
                     kp[PRE_FRAMES:PRE_FRAMES + 1, R_KNE],
                     kp[PRE_FRAMES:PRE_FRAMES + 1, R_ANK])[0]) / 2),
        # velocity-derived — gated
        "peak_wrist_speed": None,
        "time_to_peak": None,
        "follow_through": None,
        "recovery_time": None,
    }

    if velocity_ok and np.isfinite(w).any():
        pk = float(np.nanmax(w))
        out["peak_wrist_speed"] = pk
        out["time_to_peak"] = int(np.nanargmax(w) - PRE_FRAMES)
        out["follow_through"] = float(np.nansum(w[post]))
        if pk > 0:
            after = np.where(np.nan_to_num(w[post]) < 0.2 * pk)[0]
            out["recovery_time"] = float(after[0]) if len(after) else None

    return out


def group_rallies(timestamps, gap_s=RALLY_GAP_S):
    """Rallies from gaps in the contact sequence.

    Validated against 282 annotated rally endings: boundary F1 0.769, with
    recall pinned at 0.789 by the detection ceiling. The parameter is nearly
    irrelevant across a 5x range, which is a good sign — the method is not
    balanced on a hand-tuned constant.
    """
    rid, sidx, cur, last = [], [], 0, None
    for t in timestamps:
        if last is not None and (t - last) > gap_s:
            cur += 1
            k = 0
        else:
            k = 0 if last is None else sidx[-1] + 1
        rid.append(cur); sidx.append(k); last = t
    return np.array(rid), np.array(sidx)


def build_shots(peaks, sides, pr, pt, kps, vals, sels, st, source_fps,
                thresholds, prob):
    """Assemble the shot records."""
    src_frames = st["src"][peaks]
    ts = src_frames / source_fps
    rid, sidx = group_rallies(ts)
    import pandas as pd
    rlen = pd.Series(rid).value_counts().to_dict()

    shots = []
    for n, (i, s) in enumerate(zip(peaks, sides)):
        pi = 0 if s == "left" else 1
        cls = CLASSES[int(pr[n].argmax())]
        conf = float(pr[n].max())
        km = kinematics(kps[n], vals[n], st["td"][sels[n], pi],
                        R_WRI if s == "left" else L_WRI, source_fps)
        shots.append(dict(
            rally_id=int(rid[n]), shot_index=int(sidx[n]), player=s,
            frame=int(src_frames[n]), timestamp_s=float(ts[n]),
            shot_class=cls, class_confidence=conf,
            technique=TECHS[int(pt[n].argmax())],
            # control (0.804) and defence (0.556) never clear the bar, so they
            # are counted but never used to draw conclusions
            abstain=bool(conf < thresholds.get(cls, 1.01)),
            detect_confidence=float(prob[i]),
            rally_length=int(rlen[rid[n]]),
            pose_confidence=float(
                st["scores"][sels[n], pi][st["scores"][sels[n], pi] > 0].mean()
                if (st["scores"][sels[n], pi] > 0).any() else 0.0),
            detected=float(st["detected"][sels[n], pi].mean()),
            **km))
    return shots
