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
