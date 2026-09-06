/**
 * The backend data contract — one row per detected shot.
 * Mirrors PONGAI_FRONTEND_SPEC.md §3 exactly; do not add fields the backend
 * does not emit.
 */

export type ShotClass = "serve" | "attack" | "control" | "defence";

export type Player = "left" | "right";

/**
 * The 8-way technique label. Narrower than `ShotClass` and reported
 * separately by the model.
 */
export type Technique =
  "loop" | "push" | "block" | "chop" | "lob" | "flick" | "smash" | "serve";

export interface Shot {
  // identity
  rally_id: number;
  /** 0-based within its rally. */
  shot_index: number;
  player: Player;
  frame: number;
  timestamp_s: number;

  // prediction
  shot_class: ShotClass;
  /** 0-1, calibrated (temperature 2.20) — safe to render as a percentage. */
  class_confidence: number;
  technique: Technique;
  /** TRUE = do not make claims about this shot. See spec §7. */
  abstain: boolean;
  detect_confidence: number;

  // kinematics — units are TORSO-LENGTHS unless stated otherwise
  backswing_amplitude: number;
  /** Velocity-derived: requires source_fps >= 60. */
  peak_wrist_speed: number;
  /** Velocity-derived: frames, signed, relative to contact. */
  time_to_peak: number | null;
  /** Relative to the shoulder line; positive = above. */
  contact_height: number;
  /** Degrees. */
  elbow_angle: number;
  /** Degrees. */
  elbow_range: number;
  /** Degrees. */
  trunk_lean: number;
  /** Degrees. */
  trunk_rotation: number;
  table_distance: number;
  stance_width: number;
  /** Degrees. */
  knee_angle: number;
  /** Velocity-derived: requires source_fps >= 60. */
  follow_through: number;
  /** Velocity-derived: frames. Requires source_fps >= 60. */
  recovery_time: number | null;

  // quality
  rally_length: number;
  pose_confidence: number;
  /** 0-1 fraction of the window with a player box. */
  detected: number;
}

export interface Analysis {
  video_id: string;
  video_url: string;
  duration_s: number;
  /** Gates the velocity kinematics — see spec §4. */
  source_fps: number;
  width: number;
  height: number;
  shots: Shot[];
  /** Canonical keypoints, shaped [n_shots, 97, 17, 2] on a 120fps grid. */
  pose_windows?: Float32Array;
}

/**
 * What ships as a match's JSON.
 *
 * Two producers write this shape:
 *   - the synthetic generator, flat at `public/demo/{id}.json`
 *   - the real exporter, nested at `public/demo/{id}/{id}.json`
 *
 * They do not agree on every field, so anything only one of them emits is
 * optional here and must be treated as absent-by-default at the call site.
 */
export interface AnalysisFile extends Omit<Analysis, "pose_windows"> {
  /**
   * Canonical pose windows, [n_shots, 97, 17, 2] Float32 — ~10MB for a full
   * match, so served as an Int16 sidecar quantised by `poses_scale`.
   *
   * SYNTHETIC ONLY. Real exports burn the skeleton into the video instead and
   * ship no pose windows, so everything downstream of this must degrade
   * gracefully rather than assume it is present.
   */
  poses_url?: string;
  poses_scale?: number;
  /** True for generated fixtures. Real exports omit it. */
  synthetic?: boolean;
  /**
   * REAL EXPORTS ONLY. The source-video window this export covers.
   *
   * `frame` and `timestamp_s` on each shot are relative to `start_frame`, not
   * to the original footage — verified for game_1, where the clip spans
   * 21600 frames at 120fps and the served MP4 is exactly those 180 seconds.
   */
  clip?: {
    start_frame: number;
    end_frame: number;
    is_clipped: boolean;
  };
  /**
   * REAL EXPORTS ONLY, and NOT USED: it points at `/demo/{id}.track.json`,
   * one folder above where the file actually sits. Track paths are built from
   * the match id instead. See `loadCropTrack`.
   */
  track_url?: string;
}

/** Keys of `Shot` that hold a kinematic measurement. */
export type KinematicKey =
  | "backswing_amplitude"
  | "peak_wrist_speed"
  | "time_to_peak"
  | "contact_height"
  | "elbow_angle"
  | "elbow_range"
  | "trunk_lean"
  | "trunk_rotation"
  | "table_distance"
  | "stance_width"
  | "knee_angle"
  | "follow_through"
  | "recovery_time";
