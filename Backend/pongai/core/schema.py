"""
pongai.core.schema — the contract between API, worker and frontend.

Defined once and imported by both services so the shot record cannot drift.
Mirrors derived/meta/shot_record_schema.json produced by the pipeline.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

SCHEMA_VERSION = 1

# --- the 97-frame window the classifier reads, contact at index 60 -----------
WINDOW_FRAMES = 97
CONTACT_INDEX = 60
GRID_FPS = 120          # pose is resampled to this before classification


class ShotClass(str, Enum):
    SERVE = "serve"
    ATTACK = "attack"
    CONTROL = "control"
    DEFENCE = "defence"


class Player(str, Enum):
    LEFT = "left"
    RIGHT = "right"


# Held-out precision per class. `control` and `defence` are too unreliable to
# draw conclusions from, so the frontend suppresses them from findings. Kept
# here as data rather than prose so there is one place to update.
CLASS_PRECISION: dict[ShotClass, float] = {
    ShotClass.SERVE: 0.974,
    ShotClass.ATTACK: 0.857,
    ShotClass.CONTROL: 0.804,
    ShotClass.DEFENCE: 0.556,
}
COACHABLE_CLASSES = {ShotClass.SERVE, ShotClass.ATTACK}

# Position-derived: valid at any frame rate.
POSITION_KINEMATICS = (
    "backswing_amplitude", "contact_height", "elbow_angle", "elbow_range",
    "trunk_lean", "trunk_rotation", "table_distance", "stance_width",
    "knee_angle",
)
# Velocity-derived: require >= 60fps. At 30fps the wrist-speed peak is
# under-measured by ~54%, because the peak is only ~33ms wide.
VELOCITY_KINEMATICS = (
    "peak_wrist_speed", "time_to_peak", "follow_through", "recovery_time",
)
MIN_FPS_FOR_VELOCITY = 60


class Shot(BaseModel):
    """One detected stroke."""

    # identity
    rally_id: int
    shot_index: int = Field(description="0-based within the rally; 0 is the serve")
    player: Player
    frame: int
    timestamp_s: float

    # prediction
    shot_class: ShotClass
    class_confidence: float = Field(ge=0, le=1, description="temperature-calibrated")
    technique: str
    abstain: bool = Field(description="true = label too unreliable to act on")
    detect_confidence: float = Field(ge=0, le=1)

    # kinematics, in torso-lengths unless noted
    backswing_amplitude: float
    contact_height: float = Field(description="signed, relative to the shoulder line")
    elbow_angle: float = Field(description="degrees")
    elbow_range: float = Field(description="degrees")
    trunk_lean: float = Field(description="degrees")
    trunk_rotation: float = Field(description="degrees")
    table_distance: float
    stance_width: float
    knee_angle: float = Field(description="degrees")

    # velocity-derived — null when source_fps < 60
    peak_wrist_speed: float | None = None
    time_to_peak: int | None = Field(default=None, description="frames, signed, vs contact")
    follow_through: float | None = None
    recovery_time: float | None = Field(default=None, description="frames")

    # context
    rally_length: int
    pose_confidence: float = Field(ge=0, le=1)
    detected: float = Field(ge=0, le=1, description="fraction of the window with a box")


class PlayerTrack(BaseModel):
    """Crop geometry for one player's video panel."""
    crop_w: float
    crop_h: float
    detected_pct: float


class TrackHeader(BaseModel):
    """Header for the int16 crop-centre sidecar.

    Values are stored as int16 at 0.1px precision in OUTPUT pixel space,
    already smoothed and clamped. The frontend divides by `scale` and applies
    them directly — it must not smooth again.
    """
    fps: float
    n_frames: int
    video_w: int
    video_h: int
    scale: int = 10
    stride: int = 4
    layout: list[str] = ["left_cx", "left_cy", "right_cx", "right_cy"]
    dtype: Literal["int16"] = "int16"
    players: dict[str, PlayerTrack]


class AnalysisMeta(BaseModel):
    video_id: str
    duration_s: float
    source_fps: float = Field(description="gates the velocity kinematics")
    width: int
    height: int
    n_shots: int
    n_rallies: int
    schema_version: int = SCHEMA_VERSION

    @property
    def velocity_reliable(self) -> bool:
        return self.source_fps >= MIN_FPS_FOR_VELOCITY


class Analysis(BaseModel):
    """Everything the frontend needs to render one match."""
    meta: AnalysisMeta
    shots: list[Shot]
    video_url: str = Field(description="SAS URL, expires")
    track_url: str
    track_bin_url: str
    thumb_url: str | None = None


# =============================================================================
# Jobs
# =============================================================================

class JobStatus(str, Enum):
    AWAITING_UPLOAD = "awaiting_upload"
    QUEUED = "queued"
    VALIDATING = "validating"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"
    REJECTED = "rejected"      # failed validation, not an error


TERMINAL_STATUSES = {JobStatus.DONE, JobStatus.FAILED, JobStatus.REJECTED}


class JobStage(str, Enum):
    """Coarse progress. A 5-minute clip is ~25 minutes of work, so the UI
    needs more than a spinner."""
    VALIDATE = "validate"
    ACTIVITY_GATE = "activity_gate"
    POSE = "pose"
    DETECT = "detect"
    CLASSIFY = "classify"
    RENDER = "render"
    UPLOAD = "upload"


class Job(BaseModel):
    job_id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime

    filename: str | None = None
    size_bytes: int | None = None

    # what the client claimed at upload; the worker re-probes and overrides
    client_probe: "VideoProbe | None" = None
    probe: "VideoProbe | None" = None

    stage: JobStage | None = None
    progress: float = Field(default=0.0, ge=0, le=1)
    eta_s: float | None = None

    error_code: str | None = None
    error_message: str | None = None
    rejections: list["Rejection"] = []

    started_at: datetime | None = None
    finished_at: datetime | None = None

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES


class CreateUploadRequest(BaseModel):
    filename: str
    size_bytes: int
    content_type: str = "video/mp4"
    # Client-side probe. Advisory only — the worker re-probes authoritatively.
    probe: "VideoProbe | None" = None

    @field_validator("filename")
    @classmethod
    def _safe_filename(cls, v: str) -> str:
        # the filename becomes part of a blob path
        if "/" in v or "\\" in v or ".." in v:
            raise ValueError("filename must not contain path separators")
        return v[:200]


class CreateUploadResponse(BaseModel):
    job_id: str
    upload_url: str = Field(description="SAS URL; PUT the file directly here")
    blob_path: str
    expires_at: datetime
    max_size_bytes: int


class SubmitJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    queue_position: int | None = None
    estimated_wait_s: float | None = None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# resolve forward references
from pongai.core.validation import Rejection, VideoProbe  # noqa: E402

Job.model_rebuild()
CreateUploadRequest.model_rebuild()
