"""
pongai.core.validation — one set of rules, three call sites.

    browser   early UX, catches bad files before a 100MB upload
    API       cheap checks on claimed metadata
    worker    AUTHORITATIVE — re-probes the real file with ffprobe

The worker check is the real gate. A client can send anything, and failing
there costs seconds of ffprobe rather than 50 minutes of GPU.

Rules live here so the message a user sees at upload cannot disagree with the
one that comes back if the worker rejects it later.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from pydantic import BaseModel, computed_field


# =============================================================================
# Constraints
# =============================================================================

class Limits:
    MAX_SIZE_BYTES = 100 * 1024 * 1024        # 100 MB

    # Duration is what actually bounds cost — a 100MB H.265 clip can be 15
    # minutes, which is ~75 minutes of GPU. Size alone does not bound anything.
    MAX_DURATION_S = 300                       # 5 minutes
    MIN_DURATION_S = 5

    # 30fps works for detection and classification (96% class agreement in
    # testing) but loses ~54% of peak wrist speed, so velocity metrics are
    # withheld below 60. Much below that the stroke is too sparsely sampled to
    # detect reliably at all.
    #
    # The floor is 28 rather than 30 so nominally-30fps footage is not turned
    # away on a rounding error: NTSC "30fps" is really 30000/1001 = 29.97, and
    # a strict >= 30 rejects it. The two frames of margin cost nothing — the
    # measurements at 29.97 and 30 are indistinguishable.
    MIN_FPS = 28
    MAX_FPS = 240

    # Velocity kinematics are withheld below this. The single owner of the
    # number: schema.MIN_FPS_FOR_VELOCITY re-exports it, and /limits serves it
    # once. It was written out four separate times, in the two modules whose
    # whole purpose is to stop that happening.
    MIN_FPS_FOR_VELOCITY = 60

    MIN_WIDTH = 640
    MIN_HEIGHT = 360
    MAX_PIXELS = 3840 * 2160

    # A stroke window is 97 frames; anything shorter cannot produce one shot.
    MIN_FRAMES = 200

    # Vertical video cannot work: a sideline view needs the whole table in
    # frame, which 9:16 cannot contain.
    MIN_ASPECT = 1.2                           # width / height

    SAS_EXPIRY_MINUTES = 30


class RejectionCode(str, Enum):
    FILE_TOO_LARGE = "file_too_large"
    TOO_LONG = "too_long"
    TOO_SHORT = "too_short"
    FPS_TOO_LOW = "fps_too_low"
    FPS_TOO_HIGH = "fps_too_high"
    RESOLUTION_TOO_LOW = "resolution_too_low"
    RESOLUTION_TOO_HIGH = "resolution_too_high"
    ASPECT_VERTICAL = "aspect_vertical"
    # Distinct from FPS_TOO_LOW on purpose. Both used to share that code, so a
    # client keying on `code` could not tell "we cannot process this" from
    # "we will process it, without swing speed" — and warnings are now their
    # own field on the upload response and their own SSE event.
    VELOCITY_UNAVAILABLE = "velocity_unavailable"
    TOO_FEW_FRAMES = "too_few_frames"
    UNREADABLE = "unreadable"
    NO_VIDEO_STREAM = "no_video_stream"
    NO_TABLE = "no_table"
    PLAYERS_NOT_OPPOSED = "players_not_opposed"


class Severity(str, Enum):
    REJECT = "reject"        # cannot process
    WARN = "warn"            # will process, with reduced capability


class Rejection(BaseModel):
    code: RejectionCode
    severity: Severity = Severity.REJECT
    message: str             # user-facing
    detail: str | None = None

    def __str__(self) -> str:
        return f"[{self.code.value}] {self.message}"


class VideoProbe(BaseModel):
    """What we know about a video file. Produced by the browser (advisory)
    or by ffprobe in the worker (authoritative)."""
    size_bytes: int
    duration_s: float
    width: int
    height: int
    fps: float
    codec: str | None = None
    n_frames: int | None = None
    source: str = "client"       # "client" | "ffprobe"

    @property
    def aspect(self) -> float:
        return self.width / max(self.height, 1)

    @property
    def frames(self) -> int:
        return self.n_frames or int(self.duration_s * self.fps)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def velocity_reliable(self) -> bool:
        """Serialized: the probe is echoed back on every Job, and the frontend
        gates the swing-speed panel on this rather than re-deriving it."""
        return self.fps >= Limits.MIN_FPS_FOR_VELOCITY

    @property
    def estimated_gpu_seconds(self) -> float:
        """~5x realtime on a T4."""
        return self.duration_s * 5


# =============================================================================
# Rules
# =============================================================================

def validate_probe(p: VideoProbe) -> list[Rejection]:
    """All problems at once, not just the first.

    A user with a 15-minute vertical 24fps clip should see three issues in one
    response rather than fix one and resubmit twice.
    """
    out: list[Rejection] = []
    L = Limits

    if p.size_bytes > L.MAX_SIZE_BYTES:
        out.append(Rejection(
            code=RejectionCode.FILE_TOO_LARGE,
            message=f"This file is {p.size_bytes/1e6:.0f} MB. "
                    f"The limit is {L.MAX_SIZE_BYTES//1024//1024} MB.",
            detail="Trim the clip or export at a lower bitrate."))

    if p.duration_s > L.MAX_DURATION_S:
        out.append(Rejection(
            code=RejectionCode.TOO_LONG,
            message=f"This clip is {p.duration_s/60:.1f} minutes. "
                    f"The limit is {L.MAX_DURATION_S//60} minutes.",
            detail=f"Analysis runs at about 5x realtime, so this would take "
                   f"roughly {p.estimated_gpu_seconds/60:.0f} minutes."))
    elif p.duration_s < L.MIN_DURATION_S:
        out.append(Rejection(
            code=RejectionCode.TOO_SHORT,
            message=f"This clip is {p.duration_s:.1f} seconds. "
                    f"At least {L.MIN_DURATION_S} seconds are needed."))

    if p.fps < L.MIN_FPS:
        out.append(Rejection(
            code=RejectionCode.FPS_TOO_LOW,
            message=f"This video is {p.fps:.0f}fps. PongAI needs at least "
                    f"{L.MIN_FPS}fps.",
            detail=f"A stroke's acceleration phase lasts about 120ms, which "
                   f"is barely three frames at {L.MIN_FPS}fps. Below that it "
                   f"is sampled too sparsely to detect the stroke reliably."))
    elif p.fps > L.MAX_FPS:
        out.append(Rejection(
            code=RejectionCode.FPS_TOO_HIGH,
            message=f"This video is {p.fps:.0f}fps, above the {L.MAX_FPS}fps limit."))

    if p.width < L.MIN_WIDTH or p.height < L.MIN_HEIGHT:
        out.append(Rejection(
            code=RejectionCode.RESOLUTION_TOO_LOW,
            message=f"This video is {p.width}x{p.height}. At least "
                    f"{L.MIN_WIDTH}x{L.MIN_HEIGHT} is needed.",
            detail="Body joints cannot be located reliably at lower resolutions."))
    if p.width * p.height > L.MAX_PIXELS:
        out.append(Rejection(
            code=RejectionCode.RESOLUTION_TOO_HIGH,
            message=f"This video is {p.width}x{p.height}, above 4K."))

    if p.aspect < L.MIN_ASPECT:
        out.append(Rejection(
            code=RejectionCode.ASPECT_VERTICAL,
            message="This looks like a vertical video. PongAI needs a "
                    "landscape recording.",
            detail="A side-on view has to fit the whole table in frame, which "
                   "a vertical crop cannot do."))

    if p.frames < L.MIN_FRAMES:
        out.append(Rejection(
            code=RejectionCode.TOO_FEW_FRAMES,
            message=f"This clip has about {p.frames} frames. At least "
                    f"{L.MIN_FRAMES} are needed."))

    # Not a rejection — processed, with velocity metrics withheld.
    if L.MIN_FPS <= p.fps < L.MIN_FPS_FOR_VELOCITY:
        out.append(Rejection(
            code=RejectionCode.VELOCITY_UNAVAILABLE,
            severity=Severity.WARN,
            message=f"At {p.fps:.0f}fps, swing-speed metrics will be withheld.",
            detail="Shot detection, rally structure and stroke types are "
                   "unaffected. The wrist-speed peak is only about 33ms wide, "
                   "so at 30fps it is under-measured by roughly half."))

    return out


def is_acceptable(rejections: list[Rejection]) -> bool:
    return not any(r.severity == Severity.REJECT for r in rejections)


def blocking(rejections: list[Rejection]) -> list[Rejection]:
    return [r for r in rejections if r.severity == Severity.REJECT]


# =============================================================================
# ffprobe — the authoritative probe, worker side
# =============================================================================

def probe_file(path: str | Path) -> VideoProbe:
    """Read real properties from the file. Raises ValueError if unreadable."""
    path = Path(path)
    if not path.exists():
        raise ValueError(f"file not found: {path}")

    try:
        raw = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", "-select_streams", "v:0", str(path)],
            capture_output=True, text=True, timeout=120, check=True).stdout
    except subprocess.CalledProcessError as e:
        raise ValueError(f"ffprobe failed: {e.stderr[:300]}") from e
    except subprocess.TimeoutExpired as e:
        raise ValueError("ffprobe timed out") from e

    j = json.loads(raw)
    if not j.get("streams"):
        raise ValueError("no video stream")

    s, f = j["streams"][0], j.get("format", {})

    # r_frame_rate is a rational string like "120/1"
    fps = 0.0
    if rate := s.get("r_frame_rate"):
        try:
            num, den = rate.split("/")
            fps = float(num) / float(den) if float(den) else 0.0
        except (ValueError, ZeroDivisionError):
            fps = 0.0

    duration = float(f.get("duration") or s.get("duration") or 0)
    nb = int(s.get("nb_frames") or 0) or (int(duration * fps) if fps else 0)

    return VideoProbe(
        size_bytes=int(f.get("size") or path.stat().st_size),
        duration_s=duration,
        width=int(s.get("width") or 0),
        height=int(s.get("height") or 0),
        fps=fps,
        codec=s.get("codec_name"),
        n_frames=nb,
        source="ffprobe",
    )


def validate_file(path: str | Path) -> tuple[VideoProbe | None, list[Rejection]]:
    """Probe and validate in one step. Worker entry point."""
    try:
        p = probe_file(path)
    except ValueError as e:
        return None, [Rejection(
            code=RejectionCode.UNREADABLE,
            message="This file could not be read as a video.",
            detail=str(e))]

    if p.fps <= 0 or p.duration_s <= 0:
        return p, [Rejection(
            code=RejectionCode.NO_VIDEO_STREAM,
            message="No usable video stream was found in this file.")]

    return p, validate_probe(p)


# =============================================================================
# Geometry — the check that catches "wrong kind of footage"
# =============================================================================

@dataclass
class GeometryResult:
    table_found_pct: float
    players_opposed_pct: float
    frames_checked: int
    rejections: list[Rejection]
    #: Frames where two players were visible at all — the denominator for
    #: `players_opposed_pct`.
    frames_with_both: int = 0


def validate_geometry(
    detector,                      # ultralytics YOLO, loaded by the worker
    path: str | Path,
    n_samples: int = 10,
    conf: float = 0.35,
) -> GeometryResult:
    """Run the table/player detector on a handful of frames before committing
    to the full run.

    This is what catches footage the pipeline cannot handle at all: a phone
    video from a tournament hall with six tables and dozens of spectators, or
    a 45-degree angle where both players sit on the same side of frame.

    Costs a few seconds of CPU and saves ~50 minutes of GPU producing
    confident nonsense.
    """
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        return GeometryResult(0.0, 0.0, 0, [Rejection(
            code=RejectionCode.UNREADABLE,
            message="This file could not be read as a video.")])

    player_cls = next((k for k, v in detector.names.items()
                       if v.lower() == "player"), 0)
    table_cls = next((k for k, v in detector.names.items()
                      if v.lower() == "table"), 1)

    table_hits = opposed_hits = checked = both_visible = 0
    for f in np.linspace(total * 0.1, total * 0.9, n_samples).astype(int):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(f))
        ok, frame = cap.read()
        if not ok:
            continue
        checked += 1

        r = detector.predict(frame, verbose=False, conf=conf)[0]
        if r.boxes is None or not len(r.boxes):
            continue
        xyxy = r.boxes.xyxy.cpu().numpy()
        cls = r.boxes.cls.cpu().numpy().astype(int)

        tables = xyxy[cls == table_cls]
        if not len(tables):
            continue
        table_hits += 1

        biggest = tables[np.argmax((tables[:, 2] - tables[:, 0]) *
                                   (tables[:, 3] - tables[:, 1]))]
        mid_x = (biggest[0] + biggest[2]) / 2

        players = xyxy[cls == player_cls]
        if len(players) < 2:
            # One player, or none. That is dead time between rallies, not a
            # geometry problem — the question this check asks is only
            # answerable when there are two players to place.
            continue
        both_visible += 1
        cx = (players[:, 0] + players[:, 2]) / 2
        if (cx < mid_x).any() and (cx >= mid_x).any():
            opposed_hits += 1

    cap.release()
    if checked == 0:
        return GeometryResult(0.0, 0.0, 0, [Rejection(
            code=RejectionCode.UNREADABLE,
            message="No frames could be read from this video.")])

    table_pct = table_hits / checked

    # Measured over frames where two players were actually visible, NOT over
    # every sampled frame.
    #
    # Dividing by all frames conflated two unrelated things: "the camera is at
    # a bad angle" and "nobody is playing right now". A short clip that is
    # mostly dead time was rejected outright even though its rallies were
    # perfectly framed — 22% opposed across the whole clip, but 100% opposed
    # across the moments both players were on court. Whether the geometry is
    # usable is only answerable when there are two players to place.
    opposed_pct = opposed_hits / both_visible if both_visible else 0.0
    out: list[Rejection] = []

    if table_pct < 0.5:
        out.append(Rejection(
            code=RejectionCode.NO_TABLE,
            message="PongAI could not find a table tennis table in this video.",
            detail=f"A table was visible in {table_pct:.0%} of sampled frames. "
                   "It needs a clear side-on view of a single table."))
    elif both_visible == 0:
        # Never two players anywhere in the clip: there is nothing to analyse,
        # and the pipeline would spend the full run to reach the same answer.
        out.append(Rejection(
            code=RejectionCode.PLAYERS_NOT_OPPOSED,
            message="PongAI never saw two players in this video.",
            detail=f"Across {checked} sampled frames, two players were never "
                   "in frame at the same time. Both players need to be "
                   "visible, with the whole table in shot."))
    elif opposed_pct < 0.4:
        out.append(Rejection(
            code=RejectionCode.PLAYERS_NOT_OPPOSED,
            message="PongAI needs one player at each end of the table.",
            detail=f"When both players were visible, they were on opposite "
                   f"ends in only {opposed_pct:.0%} of frames. This usually "
                   "means the camera is at an angle rather than side-on, or "
                   "other people are in frame."))

    return GeometryResult(table_pct, opposed_pct, checked, out, both_visible)


# =============================================================================
# For the frontend
# =============================================================================

def limits_payload() -> dict:
    """Served at GET /limits so the browser validates against the same numbers
    rather than a hardcoded copy that drifts."""
    L = Limits
    return {
        "max_size_bytes": L.MAX_SIZE_BYTES,
        "max_duration_s": L.MAX_DURATION_S,
        "min_duration_s": L.MIN_DURATION_S,
        "min_fps": L.MIN_FPS,
        "max_fps": L.MAX_FPS,
        "min_width": L.MIN_WIDTH,
        "min_height": L.MIN_HEIGHT,
        "min_aspect": L.MIN_ASPECT,
        "velocity_min_fps": L.MIN_FPS_FOR_VELOCITY,
        "guidance": {
            "camera": "Film from the side, level with the table, with one "
                      "player at each end and the whole table in frame.",
            "fps": "60fps or higher for swing-speed metrics. 30fps works for "
                   "everything else.",
            "stability": "Use a tripod. A moving camera breaks the analysis.",
        },
    }
