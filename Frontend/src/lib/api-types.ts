/**
 * The upload/job half of the backend contract.
 *
 * Mirrors `pongai/core/schema.py` and `pongai/core/validation.py`. Shot and
 * Analysis types live in `types.ts`; these are the job lifecycle only.
 */

import type { Shot } from "./types";

export type JobStatus =
  | "awaiting_upload"
  | "queued"
  | "validating"
  | "processing"
  | "done"
  | "failed"
  | "rejected";

export type JobStage =
  | "validate"
  | "activity_gate"
  | "pose"
  | "detect"
  | "classify"
  | "render"
  | "upload";

/** `reject` blocks the upload; `warn` proceeds with reduced capability. */
export type Severity = "reject" | "warn";

export interface Rejection {
  code: string;
  severity: Severity;
  /** Written for a person to read. Render this verbatim. */
  message: string;
  detail?: string | null;
}

/** What the browser measured about a file. Advisory — the worker re-probes. */
export interface VideoProbe {
  size_bytes: number;
  duration_s: number;
  width: number;
  height: number;
  fps: number;
  n_frames?: number | null;
  source: "client";
}

export interface Job {
  job_id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  filename: string | null;
  size_bytes: number | null;
  client_probe: (VideoProbe & { velocity_reliable: boolean }) | null;
  probe: (VideoProbe & { velocity_reliable: boolean }) | null;
  stage: JobStage | null;
  /** Human wording for `stage`, computed server-side so the seven labels are
   *  not duplicated here. Null when no stage is running. */
  stage_label: string | null;
  /** 0-1, weighted by measured stage cost — pose is 60% of a run, render 30%.
   *  Equal sevenths would jump to 43% then sit still, which reads as hung. */
  progress: number;
  /** Remaining seconds from the observed rate. Null until there is enough
   *  signal; an estimate from 2% progress is noise. */
  eta_s: number | null;
  error_code: string | null;
  error_message: string | null;
  rejections: Rejection[];
  warnings: Rejection[];
  started_at: string | null;
  finished_at: string | null;
  attempts: number;
  /** Computed server-side, so the client never re-derives the terminal set. */
  is_terminal: boolean;
  can_retry: boolean;
}

/** GET /api/analyses/{job_id} — mirrors `Analysis` in core/schema.py. */
export interface Analysis {
  meta: {
    video_id: string;
    duration_s: number;
    source_fps: number;
    width: number;
    height: number;
    n_shots: number;
    n_rallies: number;
    schema_version: number;
    /** Computed server-side; do not re-derive the 60fps rule here. */
    velocity_reliable: boolean;
  };
  /** The same shot contract the demos use — defined once in the backend. */
  shots: Shot[];
  video_url: string;
  track_url: string;
  track_bin_url: string;
  thumb_url: string | null;
}

/** GET /api/jobs/{id}/source — the raw upload, playable before analysis. */
export interface SourceVideo {
  job_id: string;
  /** Read-only SAS. Expires; fetch it when the player opens, not before. */
  url: string;
  filename: string | null;
  size_bytes: number | null;
  expires_in_s: number;
}

/** POST /api/jobs/{id}/submit — the blob is verified and the job enqueued. */
export interface SubmitJobResponse {
  job_id: string;
  status: JobStatus;
  queue_position: number | null;
  estimated_wait_s: number | null;
}

export interface CreateUploadResponse {
  job_id: string;
  /** SAS URL. PUT the file straight here — it never passes through the API. */
  upload_url: string;
  blob_path: string;
  expires_at: string;
  max_size_bytes: number;
  warnings: Rejection[];
}

/**
 * GET /api/limits.
 *
 * Served so the browser checks against the same numbers the worker enforces.
 * A hardcoded copy here would drift, producing the case where the browser
 * accepts what the worker later rejects.
 */
export interface Limits {
  max_size_bytes: number;
  max_duration_s: number;
  min_duration_s: number;
  min_fps: number;
  max_fps: number;
  min_width: number;
  min_height: number;
  min_aspect: number;
  velocity_min_fps: number;
  guidance: { camera: string; fps: string; stability: string };
  model: {
    schema_version: number;
    class_precision: Record<string, number>;
    coachable_classes: string[];
    shot_classes: string[];
    position_kinematics: string[];
    velocity_kinematics: string[];
    window_frames: number;
    contact_index: number;
    grid_fps: number;
  };
}

/** Every API failure arrives in this envelope. See `pongai/api/errors.py`. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    rejections?: Rejection[];
    context?: Record<string, unknown>;
  };
}
