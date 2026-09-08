"""
pongai.worker.stages.video — decode, activity gate, pose extraction, render.
"""
from __future__ import annotations

import logging
import subprocess

import cv2
import numpy as np

from pongai.worker.stages.geometry import EDGES, L_WRI, R_WRI

log = logging.getLogger(__name__)

ACT_STRIDE_120 = 12          # 100ms at 120fps; scaled to the source rate
DET_STRIDE_120 = 8
ACT_PAD_S = 0.75
MOTION_THR = 0.02
BOX_PAD = 0.18
CHUNK = 600

BRAND = (2, 95, 245)         # #f55f02 in BGR
WRIST_COL = (60, 60, 255)


def strides_for(src_fps: float) -> tuple[int, int, int]:
    """Anything counted in FRAMES must scale with the source rate so it still
    corresponds to the same TIME interval."""
    k = 120.0 / max(src_fps, 1)
    return (max(1, round(ACT_STRIDE_120 / k)),
            max(1, round(DET_STRIDE_120 / k)),
            round(ACT_PAD_S * src_fps))


def resolve_players(detector, frames, mid_x, player_cls, conf=0.35):
    """The detector finds people but not identities, and the umpire is usually
    in frame too. The table's horizontal centre splits it: the box furthest
    left and the one furthest right are the two athletes."""
    out = []
    for r in detector.predict(frames, verbose=False, conf=conf):
        d = {"left": None, "right": None}
        if r.boxes is not None and len(r.boxes):
            xyxy = r.boxes.xyxy.cpu().numpy()
            cls = r.boxes.cls.cpu().numpy().astype(int)
            pl = xyxy[cls == player_cls]
            if len(pl):
                cx = (pl[:, 0] + pl[:, 2]) / 2
                ls, rs = pl[cx < mid_x], pl[cx >= mid_x]
                if len(ls):
                    d["left"] = ls[np.argmin((ls[:, 0] + ls[:, 2]) / 2)]
                if len(rs):
                    d["right"] = rs[np.argmax((rs[:, 0] + rs[:, 2]) / 2)]
        out.append(d)
    return out


def find_table(detector, cap, n, table_cls, k=9):
    boxes = []
    for f in np.linspace(n * 0.1, n * 0.9, k).astype(int):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(f))
        ok, fr = cap.read()
        if not ok:
            continue
        r = detector.predict(fr, verbose=False, conf=0.35)[0]
        if r.boxes is None or not len(r.boxes):
            continue
        xyxy = r.boxes.xyxy.cpu().numpy()
        cls = r.boxes.cls.cpu().numpy().astype(int)
        tb = xyxy[cls == table_cls]
        if len(tb):
            boxes.append(tb[np.argmax((tb[:, 2] - tb[:, 0]) *
                                      (tb[:, 3] - tb[:, 1]))])
    return np.median(np.stack(boxes), 0).astype(np.float32) if boxes else None


def activity_gate(detector, path, nfr, mid_x, src_fps, player_cls,
                  on_progress=None):
    """Keeps regions where both players are present and at least one is moving.

    Decodes SEQUENTIALLY. grab() advances without converting to BGR;
    retrieve() converts only sampled frames. A random seek per sampled frame
    forces the decoder back to a keyframe each time and is 9.2x slower,
    measured.
    """
    stride, _, pad = strides_for(src_fps)
    cap = cv2.VideoCapture(str(path))
    flags, idxs, buf, bidx, prev = [], [], [], [], None

    def flush():
        nonlocal buf, bidx, prev
        for j, d in enumerate(resolve_players(detector, buf, mid_x, player_cls)):
            both = d["left"] is not None and d["right"] is not None
            moving = True
            if both and prev is not None:
                h = max(d["left"][3] - d["left"][1], 1)
                mv = max(abs((d["left"][0] + d["left"][2]) / 2 - prev[0]),
                         abs((d["right"][0] + d["right"][2]) / 2 - prev[1])) / h
                moving = mv > MOTION_THR
            if both:
                prev = ((d["left"][0] + d["left"][2]) / 2,
                        (d["right"][0] + d["right"][2]) / 2)
            flags.append(both and moving)
            idxs.append(bidx[j])
        buf, bidx = [], []

    i = 0
    while i < nfr:
        if not cap.grab():
            break
        if i % stride == 0:
            ok, fr = cap.retrieve()
            if ok:
                buf.append(fr)
                bidx.append(i)
            if len(buf) >= 64:
                flush()
        i += 1
        if on_progress and i % 2000 == 0:
            on_progress(i, nfr)
    if buf:
        flush()
    cap.release()

    spans = []
    for k, f in enumerate(flags):
        if not f:
            continue
        s, e = max(0, idxs[k] - pad), min(nfr - 1, idxs[k] + pad)
        if spans and s <= spans[-1][1] + 1:
            spans[-1][1] = max(spans[-1][1], e)
        else:
            spans.append([s, e])
    return spans


def extract_pose(detector, pose, path, spans, mid_x, src_fps, player_cls,
                 on_progress=None):
    """RTMPose on detector crops. Top-down on a tight crop is substantially
    more accurate than bottom-up whole-frame.

    Boxes are detected on a stride and interpolated between — detecting every
    frame would roughly double the cost for no gain, since players move
    smoothly.
    """
    _, det_stride, _ = strides_for(src_fps)
    total = sum(e - s + 1 for s, e in spans)

    F_ = np.zeros(total, np.int32)
    KP = np.zeros((total, 2, 17, 2), np.float32)
    SC = np.zeros((total, 2, 17), np.float32)
    BX = np.zeros((total, 2, 4), np.float32)
    DT = np.zeros((total, 2), bool)
    SG = np.zeros(total, np.int32)

    cap = cv2.VideoCapture(str(path))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    w = 0

    for si, (s0, e0) in enumerate(spans):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(s0))
        pos = s0
        while pos <= e0:
            n = min(CHUNK, e0 - pos + 1)
            frames = []
            for _ in range(n):
                ok, fr = cap.read()
                frames.append(fr if ok else
                              (frames[-1] if frames
                               else np.zeros((H, W, 3), np.uint8)))
            n = len(frames)

            di = list(range(0, n, det_stride))
            if di[-1] != n - 1:
                di.append(n - 1)
            dets = resolve_players(detector, [frames[i] for i in di],
                                   mid_x, player_cls)

            boxes = {}
            for pi, side in enumerate(["left", "right"]):
                known = [(i, b) for i, b in zip(di, [d[side] for d in dets])
                         if b is not None]
                if not known:
                    continue
                ki = np.array([a for a, _ in known], float)
                kb = np.stack([b for _, b in known]).astype(float)
                boxes[pi] = np.stack(
                    [np.interp(np.arange(n), ki, kb[:, c]) for c in range(4)],
                    1).astype(np.float32)

            for k in range(n):
                bb, who = [], []
                for pi in (0, 1):
                    if pi not in boxes:
                        continue
                    b = boxes[pi][k]
                    bw, bh = b[2] - b[0], b[3] - b[1]
                    b = np.array([max(0, b[0] - bw * BOX_PAD),
                                  max(0, b[1] - bh * BOX_PAD * 0.6),
                                  min(W, b[2] + bw * BOX_PAD),
                                  min(H, b[3] + bh * BOX_PAD * 0.25)],
                                 np.float32)
                    bb.append(b); who.append(pi)
                    BX[w + k, pi] = b
                    DT[w + k, pi] = True
                if bb:
                    kp, sc = pose(frames[k], bboxes=np.stack(bb))
                    for j, pi in enumerate(who):
                        KP[w + k, pi] = kp[j]
                        SC[w + k, pi] = sc[j]
                F_[w + k] = pos + k
                SG[w + k] = si

            w += n
            pos += n
            if on_progress:
                on_progress(w, total)
            del frames

    cap.release()
    return dict(frame_idx=F_[:w], seg_id=SG[:w], keypoints=KP[:w],
                scores=SC[:w], boxes=BX[:w], detected=DT[:w])


# =============================================================================
# Render
# =============================================================================

def nvenc_available() -> bool:
    """Listing the encoder is not the same as being able to use it."""
    try:
        if "h264_nvenc" not in subprocess.run(
                ["ffmpeg", "-hide_banner", "-encoders"],
                capture_output=True, text=True, timeout=30).stdout:
            return False
        t = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", "testsrc=size=256x144:rate=30:duration=0.2",
             "-c:v", "h264_nvenc", "-f", "null", "-"],
            capture_output=True, timeout=60)
        return t.returncode == 0
    except Exception:
        return False


def build_crop_track(raw, pi, src_w, src_h, out_scale, panel_aspect=360 / 540,
                     zoom=1.20, ema=0.12, n_frames=None):
    """Crop centres for one player's video panel.

    Three things decide whether this is watchable:
      fixed zoom      - the box grows and shrinks as the player moves toward
                        the camera; following it makes them rescale constantly
                        and posture impossible to compare across shots
      smoothed centre - raw boxes jitter several pixels, which magnified into
                        a zoomed crop is a violent shake (91% reduction measured)
      gap filling     - where there is no detection the centre is interpolated
                        so the crop holds still rather than snapping
    """
    n = n_frames or (int(raw["frame_idx"].max()) + 1)
    cx = np.full(n, np.nan)
    cy = np.full(n, np.nan)
    heights = []

    for i, f in enumerate(raw["frame_idx"]):
        if not raw["detected"][i, pi]:
            continue
        x1, y1, x2, y2 = raw["boxes"][i, pi]
        if x2 <= x1 or y2 <= y1:
            continue
        cx[f] = (x1 + x2) / 2
        cy[f] = (y1 + y2) / 2
        heights.append(y2 - y1)

    if not heights:
        # Occluded for the entire clip. Raising here threw away a finished
        # pose pass, classification and render — everything except this one
        # panel. A centred static crop plus detected_pct=0 lets the frontend
        # hide the panel and keep the rest of the analysis.
        log.warning("player %d never detected; emitting a static centre crop", pi)
        crop_h = float(src_h)
        crop_w = min(crop_h * panel_aspect, src_w)
        centre_x = np.full(n, src_w / 2)
        centre_y = np.full(n, src_h / 2)
        return (centre_x * out_scale, centre_y * out_scale,
                crop_w * out_scale, crop_h * out_scale, 0.0)

    crop_h = min(float(np.median(heights)) * zoom, src_h)
    crop_w = min(crop_h * panel_aspect, src_w)

    idx = np.arange(n)
    good = ~np.isnan(cx)
    cx = np.interp(idx, idx[good], cx[good])
    cy = np.interp(idx, idx[good], cy[good])

    sx = np.empty(n); sy = np.empty(n)
    sx[0], sy[0] = cx[0], cy[0]
    for k in range(1, n):
        sx[k] = sx[k - 1] + ema * (cx[k] - sx[k - 1])
        sy[k] = sy[k - 1] + ema * (cy[k] - sy[k - 1])

    sx = np.clip(sx, crop_w / 2, src_w - crop_w / 2)
    sy = np.clip(sy, crop_h / 2, src_h - crop_h / 2)

    return (sx * out_scale, sy * out_scale,
            crop_w * out_scale, crop_h * out_scale, good.mean())


def render(path, raw, out_path, src_fps, out_w=1600, crf=30, kp_thresh=0.30,
           on_progress=None):
    """One video with skeletons drawn on, piped straight to ffmpeg.

    Writing mp4v then re-encoding encodes every frame TWICE, which was ~17 of
    24 minutes on a 12-minute clip. Raw frames go into ffmpeg's stdin instead,
    and NVENC encodes faster than the pipe can feed it, so encoding overlaps
    with decode rather than following it.

    The player panels crop from this same video in the browser using the crop
    track, so no per-player video is rendered.
    """
    cap = cv2.VideoCapture(str(path))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    out_h = int(round(out_w * src_h / src_w / 2) * 2)     # even for yuv420p
    scale = out_w / src_w

    enc = (["-c:v", "h264_nvenc", "-preset", "p4", "-tune", "hq",
            "-rc", "vbr", "-cq", str(crf), "-b:v", "0", "-bf", "2"]
           if nvenc_available() else
           ["-c:v", "libx264", "-preset", "fast", "-crf", str(crf)])
    log.info("render encoder: %s", enc[1])

    ff = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s", f"{out_w}x{out_h}", "-r", f"{src_fps:.6f}", "-i", "pipe:0",
         *enc, "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out_path)],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    # Sized from the data as well as the header: CAP_PROP_FRAME_COUNT lies for
    # some containers, and a frame_idx past the reported count used to raise
    # IndexError here — at the render stage, after ~90% of the wall time.
    lut_n = max(n, int(raw["frame_idx"].max()) + 1) if len(raw["frame_idx"]) else n
    lut = np.full(lut_n, -1, np.int32)
    lut[raw["frame_idx"]] = np.arange(len(raw["frame_idx"]))
    KP, SC, DT = raw["keypoints"], raw["scores"], raw["detected"]

    written = 0
    try:
        for f in range(n):
            ok, frame = cap.read()
            if not ok:
                break
            out = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA)
            i = lut[f]
            if i >= 0:
                for pi in (0, 1):
                    if not DT[i, pi]:
                        continue
                    kp, sc = KP[i, pi], SC[i, pi]
                    P = lambda j: (int(kp[j, 0] * scale), int(kp[j, 1] * scale))
                    for a, b in EDGES:
                        if sc[a] >= kp_thresh and sc[b] >= kp_thresh:
                            cv2.line(out, P(a), P(b), (0, 0, 0), 5, cv2.LINE_AA)
                            cv2.line(out, P(a), P(b), BRAND, 3, cv2.LINE_AA)
                    for j in range(17):
                        if sc[j] < kp_thresh:
                            continue
                        p = P(j)
                        r = 7 if j in (L_WRI, R_WRI) else 4
                        c = WRIST_COL if j in (L_WRI, R_WRI) else BRAND
                        cv2.circle(out, p, r + 2, (0, 0, 0), -1, cv2.LINE_AA)
                        cv2.circle(out, p, r, c, -1, cv2.LINE_AA)
            ff.stdin.write(np.ascontiguousarray(out).tobytes())
            written += 1
            if on_progress and written % 500 == 0:
                on_progress(written, n)
    finally:
        cap.release()
        ff.stdin.close()
        rc = ff.wait()
        err = ff.stderr.read().decode(errors="ignore")

    if rc != 0:
        raise RuntimeError(f"ffmpeg exited {rc}: {err[-1000:]}")

    # A mismatch here means the crop track and the video disagree and the
    # player panels would drift out of sync.
    if written != n:
        log.warning("wrote %d frames, source has %d", written, n)

    return out_w, out_h, written, scale
