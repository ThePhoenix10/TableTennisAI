"""
pongai.core.schema — the contract between API, worker and frontend.

Defined once and imported by both services so the shot record cannot drift.
Mirrors derived/meta/shot_record_schema.json produced by the pipeline.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    computed_field,
    field_validator,
)

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
# Owned by validation.Limits and re-exported at the bottom of this module —
# see the import there. Declared here as a name only so readers of the
# kinematics split can find it.


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

    @computed_field  # type: ignore[prop-decorator]
    @property
    def velocity_reliable(self) -> bool:
        """Serialized deliberately. A plain property is invisible to
        model_dump, which left the frontend re-deriving the 60fps rule from
        source_fps — a second copy of a threshold that lives in core."""
        return self.source_fps >= MIN_FPS_FOR_VELOCITY


class Analysis(BaseModel):
    """Everything the frontend needs to render one match."""
    meta: AnalysisMeta
    shots: list[Shot]
    video_url: str = Field(description="SAS URL, expires")
    track_url: str
    track_bin_url: str
    thumb_url: str | None = None


class DemoAnalysis(Analysis):
    """A precomputed match. Same shape as a real analysis on purpose — the
    frontend renders both through one code path, so it must not need a branch
    to read them."""
    is_demo: Literal[True] = True


class SourceVideo(BaseModel):
    """A signed link to the video a user uploaded, before any analysis.

    Separate from `Analysis.video_url`, which is the RENDERED output with
    skeletons drawn on and only exists once a job is done.
    """
    job_id: str
    url: str = Field(description="read-only SAS, expires")
    filename: str | None = None
    size_bytes: int | None = None
    expires_in_s: int


class DemoSummary(BaseModel):
    """One row of the demo index. Whatever else the index carries (title,
    players, description) is passed through rather than dropped."""
    model_config = ConfigDict(extra="allow")

    id: str
    video_url: str
    # A listing row is for picking a match, not playing one. Missing sidecars
    # are null rather than a signed URL that 404s when clicked.
    track_url: str | None = None
    track_bin_url: str | None = None
    thumb_url: str | None = None
    analysis_url: str


# =============================================================================
# Accounts
# =============================================================================

class User(BaseModel):
    """A person with an account.

    `password_hash` is excluded from serialization, so a User can be returned
    from a route without a second "public" model to keep in step — the risk
    with that pattern is that the two drift and the hash leaks.
    """
    user_id: str
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    created_at: datetime
    password_hash: str = Field(exclude=True, repr=False)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()


class SignUpRequest(BaseModel):
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class SignInRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in_s: int
    user: User


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

# A retry costs a GPU cold start plus a full run, and a deterministically
# failing job would otherwise be retryable forever.
MAX_ATTEMPTS = 3

# ProgressReporter writes at least every 2 seconds while the worker is alive,
# so this much silence means the replica is gone — evicted, OOM-killed, or
# timed out — not that it is busy. Such a job is stuck in PROCESSING with
# nothing left to move it, so it is retryable even though it never reached a
# terminal status.
STALE_AFTER_S = 600


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


# What each stage is called for a person. Beside JobStage deliberately: these
# are served to the browser on every job, and a copy in the frontend would be
# one more thing to keep in step.
STAGE_LABELS: dict[JobStage, str] = {
    JobStage.VALIDATE:      "Checking the video",
    JobStage.ACTIVITY_GATE: "Finding the rallies",
    JobStage.POSE:          "Tracking body movement",
    JobStage.DETECT:        "Detecting shots",
    JobStage.CLASSIFY:      "Classifying strokes",
    JobStage.RENDER:        "Rendering the analysis",
    JobStage.UPLOAD:        "Saving results",
}


class Job(BaseModel):
    job_id: str
    #: Owner. Also the table partition key, so listing a user's jobs and
    #: fetching one are both point reads rather than table scans.
    user_id: str
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
    rejections: list["Rejection"] = Field(
        default=[], description="blocking reasons; set when status is rejected")
    warnings: list["Rejection"] = Field(
        default=[], description="severity=warn; processed with reduced capability")

    started_at: datetime | None = None
    finished_at: datetime | None = None

    attempts: int = Field(
        default=0, description="times this job has been enqueued")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES

    @computed_field  # type: ignore[prop-decorator]
    @property
    def stage_label(self) -> str | None:
        """The current stage in words. Served so a polling client shows the
        same wording as the SSE stream without keeping its own copy."""
        return STAGE_LABELS.get(self.stage) if self.stage else None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def can_retry(self) -> bool:
        """Whether the UI should offer a Retry button.

        Necessary but not sufficient: POST /jobs/{id}/retry also checks the
        source video is still in storage, which this model cannot see.

        REJECTED is deliberately excluded. Validation is deterministic, so a
        retry would spend a cold start and a full run to produce the identical
        rejection — the fix is a different video, not another attempt.
        """
        if self.attempts >= MAX_ATTEMPTS:
            return False
        if self.status is JobStatus.FAILED:
            return True
        if self.status in (JobStatus.VALIDATING, JobStatus.PROCESSING):
            return self.seconds_since_update > STALE_AFTER_S
        return False

    @property
    def seconds_since_update(self) -> float:
        seen = self.updated_at
        if seen.tzinfo is None:                  # tolerate a naive round-trip
            seen = seen.replace(tzinfo=timezone.utc)
        return (utcnow() - seen).total_seconds()

    def reset_for_retry(self) -> None:
        """Back to QUEUED with the previous run's traces cleared.

        Keeps what describes the FILE — filename, size, both probes — and
        clears what described the failed ATTEMPT. Warnings are cleared too:
        the worker re-derives them from the same ffprobe read, so keeping them
        would only risk showing a stale set if the rules changed.
        """
        self.status = JobStatus.QUEUED
        self.attempts += 1
        self.stage = None
        self.progress = 0.0
        self.eta_s = None
        self.error_code = None
        self.error_message = None
        self.rejections = []
        self.warnings = []
        self.started_at = None
        self.finished_at = None


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
    # Non-blocking problems found in the client probe. The upload proceeds;
    # the user should be told what will be missing from the result before
    # they wait 30 minutes for it.
    warnings: list["Rejection"] = []


class SubmitJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    queue_position: int | None = None
    estimated_wait_s: float | None = None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# resolve forward references
from pongai.core.validation import (  # noqa: E402
    Limits,
    Rejection,
    VideoProbe,
)

MIN_FPS_FOR_VELOCITY = Limits.MIN_FPS_FOR_VELOCITY

Job.model_rebuild()
CreateUploadRequest.model_rebuild()
CreateUploadResponse.model_rebuild()


def model_payload() -> dict:
    """Model capability, served to the browser alongside the limits.

    CLASS_PRECISION and the kinematics split were kept here "as data rather
    than prose so there is one place to update" — but nothing served them, so
    the frontend had to hardcode 0.804 / 0.556 and its own list of which
    metrics need 60fps. That is the drift `limits_payload` exists to prevent,
    reappearing one module over.
    """
    return {
        "schema_version": SCHEMA_VERSION,
        "class_precision": {c.value: p for c, p in CLASS_PRECISION.items()},
        "coachable_classes": sorted(c.value for c in COACHABLE_CLASSES),
        "shot_classes": [c.value for c in ShotClass],
        "position_kinematics": list(POSITION_KINEMATICS),
        "velocity_kinematics": list(VELOCITY_KINEMATICS),
        # the threshold itself is served once, at limits.velocity_min_fps
        "window_frames": WINDOW_FRAMES,
        "contact_index": CONTACT_INDEX,
        "grid_fps": GRID_FPS,
    }
