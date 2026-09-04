import type { KinematicKey, ShotClass } from "./types";

/* -------------------------------------------------------------------------
   Pose windows — spec §3
   ------------------------------------------------------------------------- */

/** Contact sits at frame 60 of the 97-frame window. */
export const CONTACT_INDEX = 60;
export const WINDOW_FRAMES = 97;
/** Pose windows are on a 120fps time base, regardless of the source video. */
export const GRID_FPS = 120;

/** COCO-17 keypoint order. Index === the second-to-last axis of a pose window. */
export const KEYPOINTS = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
] as const;

export const KEYPOINT_INDEX = {
  NOSE: 0,
  LEFT_SHOULDER: 5,
  RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7,
  RIGHT_ELBOW: 8,
  LEFT_WRIST: 9,
  RIGHT_WRIST: 10,
  LEFT_HIP: 11,
  RIGHT_HIP: 12,
  LEFT_KNEE: 13,
  RIGHT_KNEE: 14,
  LEFT_ANKLE: 15,
  RIGHT_ANKLE: 16,
} as const;

/** Bone list for skeleton rendering, as [from, to] keypoint indices. */
export const SKELETON_EDGES: ReadonlyArray<readonly [number, number]> = [
  [5, 6],
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [0, 5],
  [0, 6],
];

/* -------------------------------------------------------------------------
   The frame-rate rule — spec §4

   Detection and classification survive downsampling to 30fps. Velocity does
   not: the wrist-speed peak is ~33ms wide, so at 30fps it is sampled once and
   under-measured by roughly 54%. Below 60fps these values are ABSENT from the
   UI, not greyed — see spec §7.4.
   ------------------------------------------------------------------------- */

export const POSITION_KINEMATICS = [
  "backswing_amplitude",
  "contact_height",
  "elbow_angle",
  "elbow_range",
  "trunk_lean",
  "trunk_rotation",
  "table_distance",
  "stance_width",
  "knee_angle",
] as const satisfies readonly KinematicKey[];

export const VELOCITY_KINEMATICS = [
  "peak_wrist_speed",
  "time_to_peak",
  "follow_through",
  "recovery_time",
] as const satisfies readonly KinematicKey[];

export const MIN_VELOCITY_FPS = 60;

export const isVelocityReliable = (fps: number): boolean =>
  fps >= MIN_VELOCITY_FPS;

export const VELOCITY_UNAVAILABLE_REASON =
  "Requires 60fps or higher video. At 30fps the wrist-speed peak is under-measured by about 50%.";

/* -------------------------------------------------------------------------
   Class reliability — spec §1 and §7

   Precision differs enormously by class. The UI states the real number rather
   than presenting a 56%-accurate label with the same weight as a 97%-accurate
   one, so these figures are data, not prose.
   ------------------------------------------------------------------------- */

export interface ShotClassMeta {
  readonly label: string;
  /** Single-letter marker, so colour never carries meaning alone. */
  readonly letter: "S" | "A" | "C" | "D";
  /** Held-out cross-validation precision. */
  readonly precision: number;
  /** False when the label is not reliable enough to make claims about. */
  readonly reliable: boolean;
  /** CSS custom property holding this class's verified-contrast colour. */
  readonly colorVar: string;
  /** Plain-language reason, shown wherever the class is de-emphasised. */
  readonly caveat?: string;
}

export const SHOT_CLASS_META: Record<ShotClass, ShotClassMeta> = {
  serve: {
    label: "Serve",
    letter: "S",
    precision: 0.974,
    reliable: true,
    colorVar: "var(--color-serve)",
  },
  attack: {
    label: "Attack",
    letter: "A",
    precision: 0.857,
    reliable: true,
    colorVar: "var(--color-attack)",
  },
  control: {
    label: "Control",
    letter: "C",
    precision: 0.804,
    reliable: false,
    colorVar: "var(--color-control)",
    caveat:
      "Blocks and pushes are hard to tell apart from body movement alone — the difference is mostly in the racket angle, which PongAI cannot see.",
  },
  defence: {
    label: "Defence",
    letter: "D",
    precision: 0.556,
    reliable: false,
    colorVar: "var(--color-defence)",
    caveat:
      "Chops and blocks look similar in the body alone. PongAI is right about roughly 56% of the shots it labels 'defence', so no conclusions are drawn from them.",
  },
};

export const SHOT_CLASSES = Object.keys(SHOT_CLASS_META) as ShotClass[];

/** Classes with labels reliable enough to chart. Spec §6.6. */
export const RELIABLE_SHOT_CLASSES = SHOT_CLASSES.filter(
  (c) => SHOT_CLASS_META[c].reliable,
);

/* -------------------------------------------------------------------------
   Measured model performance — spec §1
   ------------------------------------------------------------------------- */

export const MODEL_PERFORMANCE = [
  { metric: "Shot detection", value: 0.881, unit: "F1" },
  { metric: "Player attribution", value: 0.994, unit: "accuracy" },
  { metric: "Stroke classification", value: 0.792, unit: "macro-F1" },
  { metric: "End-to-end", value: 0.698, unit: "macro-F1" },
  { metric: "Rally boundaries", value: 0.769, unit: "F1" },
] as const;

/* -------------------------------------------------------------------------
   Capability boundaries — spec §8
   ------------------------------------------------------------------------- */

export const CAN_MEASURE = [
  "stance width",
  "weight transfer",
  "trunk rotation",
  "backswing amplitude",
  "contact height relative to shoulder",
  "elbow extension",
  "follow-through",
  "recovery time",
  "footwork",
  "distance from table",
  "consistency across a session",
] as const;

export const CANNOT_MEASURE = [
  "spin",
  "racket angle",
  "ball placement",
  "ball depth",
  "timing relative to the bounce",
] as const;

export const WORKS_BEST_WITH = [
  "sideline camera",
  "120 fps (60 fps minimum for swing-speed metrics)",
  "static camera on a tripod",
  "one table in frame",
  "both players visible",
] as const;

/* -------------------------------------------------------------------------
   Demo matches — spec §13
   ------------------------------------------------------------------------- */

export interface DemoMatch {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly durationLabel: string;
  readonly fps: number;
}

export const DEMO_MATCHES: readonly DemoMatch[] = [
  {
    id: "game_2",
    title: "Full match",
    summary: "~800 shots across 87 rallies.",
    durationLabel: "24 min",
    fps: 120,
  },
  {
    id: "test_1",
    title: "Attacker vs chopper",
    summary: "~84 shots, heavy on the classes PongAI is least sure about.",
    durationLabel: "2 min",
    fps: 120,
  },
  {
    id: "game_1_30fps",
    title: "30fps phone video",
    summary: "~159 shots. Swing-speed metrics are withheld at this frame rate.",
    durationLabel: "5 min",
    fps: 30,
  },
];
