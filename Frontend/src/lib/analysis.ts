import {
  KEYPOINT_INDEX,
  MIN_VELOCITY_FPS,
  POSITION_KINEMATICS,
  SHOT_CLASSES,
  WINDOW_FRAMES,
  analysisJsonUrl,
  isSyntheticDemo,
  isVelocityReliable,
} from "./constants";
import { R2_VIDEO_URL, parseExportJson } from "./real-demo";
import type {
  AnalysisFile,
  KinematicKey,
  Player,
  Shot,
  ShotClass,
} from "./types";

const KEYPOINT_COUNT = 17;
const VALUES_PER_WINDOW = WINDOW_FRAMES * KEYPOINT_COUNT * 2;

/* ------------------------------------------------------------- loading --- */

/**
 * Loads a match, real or synthetic.
 *
 * Parsed from text rather than `res.json()` because real exports can contain
 * bare `NaN` literals, which are not valid JSON — see `parseExportJson`.
 */
export async function loadAnalysis(id: string): Promise<AnalysisFile> {
  const res = await fetch(analysisJsonUrl(id));
  if (!res.ok) throw new Error(`Could not load analysis "${id}"`);
  const file = parseExportJson(await res.text());

  // The real export's own `video_url` points at a local path with no file
  // behind it; the footage is served from R2.
  if (!isSyntheticDemo(id)) file.video_url = R2_VIDEO_URL;
  return file;
}

/**
 * Fetches and dequantises the pose sidecar, or null when the match has none.
 *
 * Real exports ship no pose windows — the skeleton is already drawn into the
 * video — so this returning null is a normal outcome, not a failure. It must
 * never throw the whole screen into an error state.
 *
 * Returns a flat Float32Array; index it with `poseWindowOffset` rather than
 * slicing, so a full match does not allocate hundreds of subarrays.
 */
export async function loadPoses(
  file: AnalysisFile,
): Promise<Float32Array | null> {
  if (!file.poses_url || !file.poses_scale) return null;

  const res = await fetch(file.poses_url);
  if (!res.ok) return null;
  const raw = new Int16Array(await res.arrayBuffer());

  const out = new Float32Array(raw.length);
  const inverseScale = 1 / file.poses_scale;
  for (let i = 0; i < raw.length; i += 1) out[i] = raw[i] * inverseScale;
  return out;
}

/** Start index of a shot's window within the flat pose array. */
export const poseWindowOffset = (shotIndex: number) =>
  shotIndex * VALUES_PER_WINDOW;

/** Reads keypoint `k` at frame `f` of shot `s`. */
export function readKeypoint(
  poses: Float32Array,
  shotIndex: number,
  frame: number,
  keypoint: number,
): [x: number, y: number] {
  const base =
    poseWindowOffset(shotIndex) + (frame * KEYPOINT_COUNT + keypoint) * 2;
  return [poses[base], poses[base + 1]];
}

/**
 * How close to a shot's timestamp still counts as being at it.
 *
 * Seeking a `<video>` to an exact timestamp lands on the nearest decodable
 * frame, which is often a few milliseconds EARLIER than requested. Without
 * slack, selecting a shot at 16.883s leaves `currentTime` at 16.880s, the
 * `timestamp_s <= time` test fails, and the shot the user just picked reads as
 * "not selected" — which then breaks arrow-key stepping, since every press
 * starts over from nothing.
 *
 * One frame at 30fps is comfortably larger than any seek error and far smaller
 * than the gap between two shots.
 */
export const SHOT_SELECT_TOLERANCE_S = 1 / 30;

/* -------------------------------------------------------------- rallies -- */

export interface Rally {
  id: number;
  shots: Shot[];
  start_s: number;
  end_s: number;
  length: number;
  /** Whoever played shot 0 — the first shot of a rally is always a serve. */
  server: Player;
}

/**
 * Rally spans are not in the data contract, so they are derived from the
 * first and last shot sharing a `rally_id`. Needed for "dim between rallies"
 * (addendum §7) and for rally-level navigation.
 */
export function buildRallies(shots: Shot[]): Rally[] {
  const byId = new Map<number, Shot[]>();
  for (const shot of shots) {
    const bucket = byId.get(shot.rally_id);
    if (bucket) bucket.push(shot);
    else byId.set(shot.rally_id, [shot]);
  }

  return [...byId.entries()]
    .map(([id, rallyShots]) => {
      const ordered = [...rallyShots].sort(
        (a, b) => a.shot_index - b.shot_index,
      );
      return {
        id,
        shots: ordered,
        start_s: ordered[0].timestamp_s,
        end_s: ordered[ordered.length - 1].timestamp_s,
        length: ordered.length,
        server: ordered[0].player,
      };
    })
    .sort((a, b) => a.start_s - b.start_s);
}

/**
 * The rally containing `time`, or the one in progress. Null between points.
 *
 * Carries the same seek tolerance as `shotIndexAt`: seeking to a rally's first
 * shot lands a few milliseconds early, which would otherwise report "between
 * rallies" at the exact moment the user asked to see that rally.
 */
export function rallyAt(rallies: Rally[], time: number): Rally | null {
  for (const rally of rallies) {
    if (
      time >= rally.start_s - SHOT_SELECT_TOLERANCE_S &&
      time <= rally.end_s + SHOT_SELECT_TOLERANCE_S
    ) {
      return rally;
    }
  }
  return null;
}

/** Index of the most recent shot at or before `time`, or -1. */
export function shotIndexAt(shots: Shot[], time: number): number {
  const cutoff = time + SHOT_SELECT_TOLERANCE_S;
  let lo = 0;
  let hi = shots.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (shots[mid].timestamp_s <= cutoff) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/* ---------------------------------------------------------- statistics --- */

/**
 * Kinematics whose zero is a true origin, so a ratio to the mean is meaningful
 * and a coefficient of variation can be quoted as a percentage.
 *
 * The others are INTERVAL-scale: their zero is an arbitrary reference point
 * (the shoulder line, vertical, the contact frame) and their mean sits near it,
 * so sd/|mean| explodes into a meaningless number — measured contact height is
 * 0.10 ± 0.17 torso, which would print as "±177% consistent". For those,
 * variability is reported as an absolute spread in the metric's own units.
 */
export const RATIO_SCALE_KINEMATICS = new Set<KinematicKey>([
  "backswing_amplitude",
  "elbow_angle",
  "elbow_range",
  "trunk_rotation",
  "table_distance",
  "stance_width",
  "knee_angle",
  "peak_wrist_speed",
  "follow_through",
  "recovery_time",
]);

export const isRatioScale = (key: KinematicKey) =>
  RATIO_SCALE_KINEMATICS.has(key);

export interface Stat {
  mean: number;
  sd: number;
  /**
   * Coefficient of variation — sd / |mean|. Only meaningful for ratio-scale
   * metrics; null for the interval-scale ones, where `sd` is the honest
   * measure of spread. See `RATIO_SCALE_KINEMATICS`.
   */
  cv: number | null;
  n: number;
}

export function summarise(values: number[], ratioScale = true): Stat | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;

  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  // Sample sd (n-1): these are samples of a player's technique, not a census.
  const variance =
    clean.length > 1
      ? clean.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (clean.length - 1)
      : 0;
  const sd = Math.sqrt(variance);

  // Guard the ratio even on ratio-scale metrics: once the spread approaches the
  // mean, the mean stops being a stable reference and the percentage says more
  // about proximity to zero than about the player. Requiring |mean| > 2·sd caps
  // a reported CV at ~50%, above which the absolute spread is the honest number.
  const cv =
    ratioScale && Math.abs(mean) > Math.max(1e-9, sd * 2)
      ? sd / Math.abs(mean)
      : null;

  return { mean, sd, cv, n: clean.length };
}

/**
 * A coefficient of variation over 3 samples is noise, so consistency stats are
 * suppressed below this (addendum §7).
 */
export const MIN_SHOTS_FOR_CONSISTENCY = 5;

export interface ShotMixRow {
  shotClass: ShotClass;
  count: number;
  share: number;
  /** How many of these carried `abstain: true`. */
  abstained: number;
}

export function shotMix(shots: Shot[]): ShotMixRow[] {
  return SHOT_CLASSES.map((shotClass) => {
    const of = shots.filter((s) => s.shot_class === shotClass);
    return {
      shotClass,
      count: of.length,
      share: shots.length ? of.length / shots.length : 0,
      abstained: of.filter((s) => s.abstain).length,
    };
  });
}

/** Share of shots whose label is reliable enough to quote. Addendum §3.1. */
export function reliableLabelCount(shots: Shot[]) {
  const reliable = shots.filter((s) => !s.abstain).length;
  return {
    reliable,
    total: shots.length,
    share: shots.length ? reliable / shots.length : 0,
  };
}

/**
 * Per-kinematic stats for one player, restricted to a single class.
 *
 * The class filter is not optional in spirit: averaging a serve and a block
 * together produces a number that describes neither (addendum §3.3).
 */
export function kinematicStats(
  shots: Shot[],
  keys: readonly KinematicKey[],
): Map<KinematicKey, Stat | null> {
  const out = new Map<KinematicKey, Stat | null>();
  for (const key of keys) {
    const values = shots
      .map((s) => s[key])
      .filter((v): v is number => typeof v === "number");
    out.set(key, summarise(values, isRatioScale(key)));
  }
  return out;
}

export interface ConsistencyRow {
  key: KinematicKey;
  stat: Stat;
}

/**
 * Position kinematics ranked least-consistent first. Addendum §3.5.
 *
 * Ranking uses the CV where one exists, and falls back to spread relative to
 * the metric's own range for interval-scale metrics, so contact height can
 * still be ranked without quoting a nonsense percentage.
 */
export function consistency(shots: Shot[]): ConsistencyRow[] {
  if (shots.length < MIN_SHOTS_FOR_CONSISTENCY) return [];

  const stats = kinematicStats(shots, POSITION_KINEMATICS);
  const rank = (key: KinematicKey, stat: Stat) =>
    stat.cv ?? stat.sd / (KINEMATIC_LABELS[key].typicalRange || 1);

  return [...stats.entries()]
    .flatMap(([key, stat]) =>
      stat && stat.n >= MIN_SHOTS_FOR_CONSISTENCY ? [{ key, stat }] : [],
    )
    .sort((a, b) => rank(b.key, b.stat) - rank(a.key, a.stat));
}

/* ------------------------------------------------------- match analytics -- */

export interface ExchangeCell {
  from: ShotClass;
  to: ShotClass;
  count: number;
  share: number;
}

/**
 * Given a player played class X, what did the opponent play next?
 * The closest thing to tactical insight available without ball tracking.
 */
export function exchangeMatrix(rallies: Rally[]): ExchangeCell[] {
  const counts = new Map<string, number>();

  for (const rally of rallies) {
    for (let i = 0; i < rally.shots.length - 1; i += 1) {
      const from = rally.shots[i];
      const to = rally.shots[i + 1];
      // Only count genuine alternations between the two players.
      if (from.player === to.player) continue;
      const key = `${from.shot_class}>${to.shot_class}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return SHOT_CLASSES.flatMap((from) => {
    const rowTotal = SHOT_CLASSES.reduce(
      (sum, to) => sum + (counts.get(`${from}>${to}`) ?? 0),
      0,
    );
    return SHOT_CLASSES.map((to) => {
      const count = counts.get(`${from}>${to}`) ?? 0;
      return { from, to, count, share: rowTotal ? count / rowTotal : 0 };
    });
  });
}

export interface TempoPoint {
  minute: number;
  shots: number;
}

/** Shots per minute across the match. Addendum §4.2. */
export function matchTempo(shots: Shot[], durationS: number): TempoPoint[] {
  const minutes = Math.max(1, Math.ceil(durationS / 60));
  const buckets = new Array<number>(minutes).fill(0);
  for (const shot of shots) {
    const m = Math.min(minutes - 1, Math.floor(shot.timestamp_s / 60));
    buckets[m] += 1;
  }
  return buckets.map((count, minute) => ({ minute, shots: count }));
}

export interface HistogramBin {
  label: string;
  from: number;
  to: number;
  count: number;
}

/** Rally-length histogram. Addendum §4.1. */
export function rallyLengthHistogram(rallies: Rally[]): HistogramBin[] {
  const edges = [1, 3, 5, 7, 9, 13, 17, 25, Infinity];
  return edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1];
    const count = rallies.filter(
      (r) => r.length >= from && r.length < to,
    ).length;
    return {
      from,
      to,
      label:
        to === Infinity
          ? `${from}+`
          : to - from === 1
            ? `${from}`
            : `${from}–${to - 1}`,
      count,
    };
  });
}

export interface QualityStrip {
  meanPoseConfidence: number;
  meanDetectionRate: number;
  abstainedShare: number;
  sourceFps: number;
  velocityAvailable: boolean;
}

/** The quiet strip that tells a user whether to trust the rest. Addendum §4.5. */
export function analysisQuality(file: AnalysisFile): QualityStrip {
  const { shots, source_fps } = file;
  const mean = (pick: (s: Shot) => number) =>
    shots.length
      ? shots.reduce((sum, s) => sum + pick(s), 0) / shots.length
      : 0;

  return {
    meanPoseConfidence: mean((s) => s.pose_confidence),
    meanDetectionRate: mean((s) => s.detected),
    abstainedShare: shots.length
      ? shots.filter((s) => s.abstain).length / shots.length
      : 0,
    sourceFps: source_fps,
    velocityAvailable: isVelocityReliable(source_fps),
  };
}

/* ---------------------------------------------------------- wrist speed --- */

/**
 * Per-frame wrist speed across a shot's window, in torso-lengths per frame on
 * the 120fps pose grid. This is the signal the detector actually reads, and
 * the sparkline in the skeleton panel plots it (addendum §2).
 *
 * Derived from pose geometry, so it is available at any source fps — but the
 * model's own `peak_wrist_speed` field is not. Do not use this to backfill a
 * gated velocity metric; that would defeat the point of the gate.
 */
export function wristSpeedSeries(
  poses: Float32Array,
  shotIndex: number,
): Float32Array {
  const out = new Float32Array(WINDOW_FRAMES);
  for (let f = 1; f < WINDOW_FRAMES; f += 1) {
    let best = 0;
    for (const k of [KEYPOINT_INDEX.LEFT_WRIST, KEYPOINT_INDEX.RIGHT_WRIST]) {
      const [x1, y1] = readKeypoint(poses, shotIndex, f - 1, k);
      const [x2, y2] = readKeypoint(poses, shotIndex, f, k);
      best = Math.max(best, Math.hypot(x2 - x1, y2 - y1));
    }
    out[f] = best;
  }
  out[0] = out[1];
  return out;
}

/* --------------------------------------------------------- formatting ---- */

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const formatPercent = (fraction: number, dp = 0) =>
  `${(fraction * 100).toFixed(dp)}%`;

/**
 * Units for display, kept beside the data so labels never drift.
 *
 * `typicalRange` is the plausible span of the metric across players. It is only
 * used to rank and threshold the interval-scale metrics, where a ratio to the
 * mean is meaningless — it is a display-scale constant, never a claim about a
 * reference population.
 */
export const KINEMATIC_LABELS: Record<
  KinematicKey,
  { label: string; unit: string; dp: number; typicalRange: number }
> = {
  backswing_amplitude: {
    label: "Backswing amplitude",
    unit: "torso",
    dp: 2,
    typicalRange: 1.2,
  },
  contact_height: {
    label: "Contact height",
    unit: "torso",
    dp: 2,
    typicalRange: 0.6,
  },
  elbow_angle: { label: "Elbow angle", unit: "°", dp: 0, typicalRange: 90 },
  elbow_range: { label: "Elbow range", unit: "°", dp: 0, typicalRange: 90 },
  trunk_lean: { label: "Trunk lean", unit: "°", dp: 0, typicalRange: 30 },
  trunk_rotation: {
    label: "Trunk rotation",
    unit: "°",
    dp: 0,
    typicalRange: 70,
  },
  table_distance: {
    label: "Distance from table",
    unit: "torso",
    dp: 2,
    typicalRange: 2.5,
  },
  stance_width: {
    label: "Stance width",
    unit: "torso",
    dp: 2,
    typicalRange: 0.8,
  },
  knee_angle: { label: "Knee angle", unit: "°", dp: 0, typicalRange: 50 },
  peak_wrist_speed: {
    label: "Peak wrist speed",
    unit: "torso/frame",
    dp: 3,
    typicalRange: 0.25,
  },
  time_to_peak: {
    label: "Time to peak",
    unit: "frames",
    dp: 0,
    typicalRange: 8,
  },
  follow_through: {
    label: "Follow-through",
    unit: "torso",
    dp: 2,
    typicalRange: 1.0,
  },
  recovery_time: {
    label: "Recovery time",
    unit: "frames",
    dp: 0,
    typicalRange: 30,
  },
};

export const VELOCITY_GATE_MESSAGE = (fps: number) =>
  `Swing-speed metrics need 60fps or higher video. This clip is ${fps}fps, where the wrist-speed peak is under-measured by about 50%.`;

export { MIN_VELOCITY_FPS };
