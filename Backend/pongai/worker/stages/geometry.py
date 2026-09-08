"""
pongai.worker.stages.geometry — COCO layout, canonicalisation, frame-rate
resampling.

Canonicalisation removes camera distance and player size so the models see
stroke mechanics rather than pixel positions.

One constraint is worth understanding before touching the mirroring: a flip
(negate x + swap left/right joints) changes SIDE and HANDEDNESS together, so
the four combinations form two closed orbits. `side XOR handedness` is
invariant and physically real — a right-hander at the left end shows their
forehand toward the camera, at the right end away. One binary residual is
therefore unavoidable. Side is a 50/50 split and handedness only ~4%, so side
is what gets normalised.
"""
from __future__ import annotations

import numpy as np

# COCO-17
NOSE = 0
L_SHO, R_SHO, L_ELB, R_ELB, L_WRI, R_WRI = 5, 6, 7, 8, 9, 10
L_HIP, R_HIP, L_KNE, R_KNE, L_ANK, R_ANK = 11, 12, 13, 14, 15, 16

FLIP_PAIRS = [(1, 2), (3, 4), (5, 6), (7, 8), (9, 10),
              (11, 12), (13, 14), (15, 16)]
EDGES = [(5, 6), (5, 7), (7, 9), (6, 8), (8, 10), (5, 11), (6, 12), (11, 12),
         (11, 13), (13, 15), (12, 14), (14, 16), (0, 5), (0, 6)]

# Window: asymmetric on purpose. A block's defining property is the ABSENCE of
# a backswing, so pre-contact carries more class information than follow-through.
PRE_FRAMES, POST_FRAMES = 60, 36
WINDOW_FRAMES = PRE_FRAMES + POST_FRAMES + 1     # 97
GRID_FPS = 120

CONF_MIN = 0.35


def torso_scale(kp: np.ndarray) -> float:
    """Median shoulder-to-hip distance over frames where it is measurable.

    Per-frame scaling would let one bad frame rescale that frame's whole
    skeleton and inject a spike exactly where the detector looks for one.
    """
    t = np.linalg.norm((kp[:, L_SHO] + kp[:, R_SHO]) / 2
                       - (kp[:, L_HIP] + kp[:, R_HIP]) / 2, axis=-1)
    t = t[t > 1]
    return float(np.median(t)) if t.size else 1.0


def canonicalise(kp: np.ndarray, sc: np.ndarray, seg: np.ndarray,
                 mirror: bool) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Hip-centre, torso-scale, optionally mirror. Returns (kp, sc, scale)."""
    kp = kp.astype(np.float32).copy()
    hip = (kp[:, L_HIP] + kp[:, R_HIP]) / 2
    sho = (kp[:, L_SHO] + kp[:, R_SHO]) / 2
    torso = np.linalg.norm(sho - hip, axis=-1)

    scale = np.ones(len(kp), np.float32)
    for s in np.unique(seg):                 # per-segment, not per-frame
        m = seg == s
        t = torso[m]
        t = t[t > 1]
        scale[m] = np.median(t) if t.size else 1.0

    kp = (kp - hip[:, None, :]) / np.maximum(scale, 1e-3)[:, None, None]

    if mirror:
        kp[..., 0] *= -1
        sc = sc.copy()
        for a, b in FLIP_PAIRS:
            kp[:, [a, b]] = kp[:, [b, a]]
            sc[:, [a, b]] = sc[:, [b, a]]
    return kp, sc, scale


def resample_to_grid(raw: dict, src_fps: float,
                     grid_fps: float = GRID_FPS) -> dict:
    """Native-fps pose -> a `grid_fps` time base.

    The models take a fixed 97-frame input, so feeding them 24 frames from a
    30fps clip is not an option. Pose is extracted at native fps and the
    POSITIONS interpolated onto a 120fps grid; velocity is differenced
    afterwards, which restores the units the models were trained on.

    Order matters: computing velocity at 30fps and rescaling gives a different
    and wrong answer, because consecutive-frame displacement spans 4x the time.

    Interpolation restores units, not information. At 30fps the wrist-speed
    peak is under-measured by ~54% because that peak is only ~33ms wide.
    Detection and classification survive (96% class agreement, measured);
    velocity kinematics do not, which is why they are gated at 60fps.
    """
    if abs(src_fps - grid_fps) < 0.5:
        out = dict(raw)
        out["src_frame"] = raw["frame_idx"].astype(np.float32)
        return out

    r = grid_fps / src_fps
    F_src, seg = raw["frame_idx"], raw["seg_id"]
    oF, oS, oKP, oSC, oBX, oDT, oSRC = [], [], [], [], [], [], []

    for s in np.unique(seg):
        m = seg == s
        f = F_src[m].astype(np.float64)
        if len(f) < 2:
            continue
        g = np.arange(f[0] * r, f[-1] * r + 1)
        src_pos = g / r

        kp, sc = raw["keypoints"][m], raw["scores"][m]
        bx, dt = raw["boxes"][m], raw["detected"][m]

        nk = np.zeros((len(g), 2, 17, 2), np.float32)
        nb = np.zeros((len(g), 2, 4), np.float32)
        for pi in (0, 1):
            for j in range(17):
                for c in (0, 1):
                    nk[:, pi, j, c] = np.interp(src_pos, f, kp[:, pi, j, c])
            for c in range(4):
                nb[:, pi, c] = np.interp(src_pos, f, bx[:, pi, c])

        # nearest for flags — interpolating a confidence would invent certainty
        near = np.clip(np.searchsorted(f, src_pos), 0, len(f) - 1)

        oF.append(g.astype(np.int32))
        oS.append(np.full(len(g), s, np.int32))
        oKP.append(nk); oSC.append(sc[near]); oBX.append(nb)
        oDT.append(dt[near]); oSRC.append(src_pos.astype(np.float32))

    return dict(
        frame_idx=np.concatenate(oF), seg_id=np.concatenate(oS),
        keypoints=np.concatenate(oKP), scores=np.concatenate(oSC),
        boxes=np.concatenate(oBX), detected=np.concatenate(oDT),
        src_frame=np.concatenate(oSRC),
    )


def build_stream(raw: dict, table: np.ndarray | None) -> dict:
    """Canonical per-frame feature stream for both players.

    170 channels for the detector: 2 x (34 kp + 34 vel + 17 conf).
    """
    seg = raw["seg_id"]
    KP, SC, DT = raw["keypoints"], raw["scores"], raw["detected"]
    ch, kps, vals, tds = [], [], [], []

    for pi in (0, 1):
        kp, sc, scale = canonicalise(
            KP[:, pi], SC[:, pi].astype(np.float32), seg, mirror=(pi == 1))
        vel = np.zeros_like(kp)
        vel[1:] = np.diff(kp, axis=0)
        vel[np.diff(seg, prepend=seg[0]) != 0] = 0     # no velocity across cuts

        ch += [kp.reshape(len(kp), -1), vel.reshape(len(kp), -1),
               (sc * DT[:, pi:pi + 1]).astype(np.float32)]
        kps.append(kp)
        vals.append((sc >= CONF_MIN) & DT[:, pi:pi + 1])

        hx = (KP[:, pi, L_HIP, 0] + KP[:, pi, R_HIP, 0]) / 2
        if table is not None and table[2] > table[0]:
            edge = table[0] if pi == 0 else table[2]
            tds.append(np.abs(hx - edge) / np.maximum(scale, 1e-3))
        else:
            tds.append(np.zeros(len(kp), np.float32))

    cuts = np.where(np.diff(seg) != 0)[0] + 1
    b = np.concatenate([[0], cuts, [len(seg)]])

    return dict(
        X=np.nan_to_num(np.concatenate(ch, 1).astype(np.float32)),
        kp=np.stack(kps, 1), val=np.stack(vals, 1),
        td=np.nan_to_num(np.stack(tds, 1)),
        fidx=raw["frame_idx"],
        src=raw.get("src_frame", raw["frame_idx"].astype(np.float32)),
        scores=SC, detected=DT,
        spans=[(int(b[i]), int(b[i + 1])) for i in range(len(b) - 1)],
    )


def window_at(st: dict, idx: int, side: str):
    """97-channel-major window for the classifier: kp(34) vel(34) valid(17)
    table_dist(1) = 86 channels."""
    sel = np.clip(np.arange(idx - PRE_FRAMES, idx - PRE_FRAMES + WINDOW_FRAMES),
                  0, len(st["X"]) - 1)
    pi = 0 if side == "left" else 1
    kp = st["kp"][sel, pi]
    val = st["val"][sel, pi].astype(np.float32)
    vel = np.zeros_like(kp)
    vel[1:] = np.diff(kp, axis=0)
    x = np.concatenate([kp.reshape(WINDOW_FRAMES, -1),
                        vel.reshape(WINDOW_FRAMES, -1),
                        val, st["td"][sel, pi][:, None]], 1)
    return np.nan_to_num(x).T.astype(np.float32), kp, val, sel


def angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Angle at b, in degrees."""
    v1, v2 = a - b, c - b
    cs = (v1 * v2).sum(-1) / np.maximum(
        np.linalg.norm(v1, axis=-1) * np.linalg.norm(v2, axis=-1), 1e-6)
    return np.degrees(np.arccos(np.clip(cs, -1, 1)))
