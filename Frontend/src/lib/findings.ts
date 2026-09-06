import {
  KINEMATIC_LABELS,
  isRatioScale,
  summarise,
  type Stat,
} from "./analysis";
import {
  POSITION_KINEMATICS,
  VELOCITY_KINEMATICS,
  isVelocityReliable,
} from "./constants";
import type { KinematicKey, Player, Shot, ShotClass } from "./types";

/**
 * The findings layer — revision 2 §2.
 *
 * A coach is not reviewing 400 shots; they are looking for the one or two
 * things worth working on. These rules compute candidates, rank them, and cap
 * the list. Pure functions, no React.
 *
 * The rule underneath every threshold here: show one finding rather than
 * three, and none rather than a spurious one. A coach who is told something
 * wrong once stops trusting the tool — and unlike a wrong number in a table, a
 * wrong recommendation gets acted on.
 */

export type FindingKind = "inconsistency" | "rally_degradation" | "strength";

export interface Finding {
  id: string;
  player: Player;
  kind: FindingKind;
  severity: "warn" | "good";
  metric: KinematicKey;
  /** Which class it was computed over. Never mixed. */
  shotClass: ShotClass;
  headline: string;
  detail: string;
  evidence: {
    sampleSize: number;
    /** Three shot indices furthest from the mean. */
    extremeShots: number[];
    /** Three shot indices nearest the mean. */
    typicalShots: number[];
  };
  score: number;
}

/* ------------------------------------------------------------ thresholds -- */

/**
 * Never generate a finding from these. Precision is 0.804 and 0.556 — a
 * recommendation built on a `defence` label is close to a coin flip. They stay
 * in shot counts so totals are honest; they never produce advice.
 */
export const EXCLUDED_CLASSES: readonly ShotClass[] = ["control", "defence"];

/**
 * NOTE ON THE REAL MATCH. `game_1` is 40 shots, which gives at most 10 attacks
 * and 5 serves to a single player — so it clears none of the floors below and
 * produces no findings at all. That is the intended behaviour, not a bug:
 * loosening these to make the flagship demo show something would be exactly the
 * guessing this module exists to prevent. `emptyFindingsMessage` says so in the
 * UI, and distinguishes it from a genuine "nothing stands out".
 */
const INCONSISTENCY_CV = 0.2;
const INCONSISTENCY_MIN_N = 15;
/**
 * Interval-scale metrics have no meaningful CV (their mean sits near an
 * arbitrary zero), so they are thresholded on spread as a fraction of the
 * metric's typical range instead. See `isRatioScale`.
 */
const INCONSISTENCY_SPREAD_RATIO = 0.2;

const DEGRADATION_CHANGE = 0.15;
const DEGRADATION_MIN_N = 10;
const EARLY_MAX_INDEX = 2;
const LATE_MIN_INDEX = 5;

const STRENGTH_CV = 0.12;
const STRENGTH_MIN_N = 10;

const MAX_PER_PLAYER = 3;

/* --------------------------------------------------------------- helpers -- */

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

const valuesOf = (shots: Shot[], key: KinematicKey): number[] =>
  shots.map((s) => s[key]).filter((v): v is number => typeof v === "number");

/**
 * Relative variability on a 0-1 scale, comparable across metrics: the CV where
 * one is meaningful, otherwise spread against the metric's typical range.
 */
function variability(key: KinematicKey, stat: Stat): number {
  if (stat.cv !== null) return stat.cv;
  return stat.sd / (KINEMATIC_LABELS[key].typicalRange || 1);
}

/**
 * How a metric's variability is phrased.
 *
 * A percentage only where one is meaningful; otherwise the absolute spread,
 * spelled out in full and marked as a standard deviation. Mixing a bare
 * "±0.15 torso" among percentages reads as though the units were an oversight,
 * when in fact it is the only honest form for a metric centred near zero.
 */
export function variabilityLabel(key: KinematicKey, stat: Stat): string {
  const { unit, dp } = KINEMATIC_LABELS[key];
  if (stat.cv !== null) return `±${Math.round(stat.cv * 100)}%`;
  return `±${stat.sd.toFixed(dp)} ${spellOutUnit(unit)} (SD)`;
}

/** Long-form units, for prose where an abbreviation would be ambiguous. */
export function spellOutUnit(unit: string): string {
  if (unit === "torso") return "torso-lengths";
  if (unit === "°") return "degrees";
  if (unit === "torso/frame") return "torso-lengths per frame";
  return unit;
}

/**
 * Picks the three shots furthest from and nearest to the mean — the pairs
 * evidence mode plays side by side.
 */
function pickEvidence(
  shots: Shot[],
  indices: number[],
  key: KinematicKey,
  mean: number,
) {
  const scored = indices
    .map((i) => ({ i, d: Math.abs((shots[i][key] as number) - mean) }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d);

  return {
    typicalShots: scored.slice(0, 3).map((x) => x.i),
    extremeShots: scored
      .slice(-3)
      .reverse()
      .map((x) => x.i),
  };
}

/** Indices into the FULL shot array, so evidence can address them globally. */
function indicesOf(
  shots: Shot[],
  player: Player,
  shotClass: ShotClass,
): number[] {
  const out: number[] = [];
  shots.forEach((s, i) => {
    if (s.player === player && s.shot_class === shotClass) out.push(i);
  });
  return out;
}

/**
 * Which kinematics are eligible, given the frame rate.
 *
 * Velocity kinematics are ~54% under-measured below 60fps, so a "wrist speed
 * is inconsistent" finding from a 30fps clip would be an artefact of the frame
 * rate rather than anything about the player.
 */
function eligibleMetrics(sourceFps: number): readonly KinematicKey[] {
  return isVelocityReliable(sourceFps)
    ? [...POSITION_KINEMATICS, ...VELOCITY_KINEMATICS]
    : POSITION_KINEMATICS;
}

/* ----------------------------------------------------------------- rules -- */

/** Rule 1 — inconsistency, computed per class and never across classes. */
function inconsistencyFindings(
  shots: Shot[],
  player: Player,
  sourceFps: number,
): Finding[] {
  const out: Finding[] = [];

  for (const shotClass of ["attack", "serve"] as const) {
    const indices = indicesOf(shots, player, shotClass);
    if (indices.length < INCONSISTENCY_MIN_N) continue;
    const subset = indices.map((i) => shots[i]);

    for (const metric of eligibleMetrics(sourceFps)) {
      const stat = summarise(valuesOf(subset, metric), isRatioScale(metric));
      if (!stat || stat.n < INCONSISTENCY_MIN_N) continue;

      const v = variability(metric, stat);
      const threshold =
        stat.cv !== null ? INCONSISTENCY_CV : INCONSISTENCY_SPREAD_RATIO;
      if (v <= threshold) continue;

      const { label } = KINEMATIC_LABELS[metric];
      out.push({
        id: `${player}-incons-${shotClass}-${metric}`,
        player,
        kind: "inconsistency",
        severity: "warn",
        metric,
        shotClass,
        headline: `${label} varies ${variabilityLabel(metric, stat)} on ${shotClass}s`,
        detail: "",
        evidence: {
          sampleSize: stat.n,
          ...pickEvidence(shots, indices, metric, stat.mean),
        },
        score: v * Math.log(stat.n),
      });
    }
  }

  return out;
}

/**
 * Rule 2 — rally degradation.
 *
 * Something a coach suspects but cannot measure by eye. Attacks only: include
 * other classes and you confound it with later shots simply being more
 * defensive.
 */
function degradationFindings(
  shots: Shot[],
  player: Player,
  sourceFps: number,
): Finding[] {
  const out: Finding[] = [];
  const indices = indicesOf(shots, player, "attack");

  const earlyIdx = indices.filter(
    (i) => shots[i].shot_index <= EARLY_MAX_INDEX,
  );
  const lateIdx = indices.filter((i) => shots[i].shot_index >= LATE_MIN_INDEX);
  if (earlyIdx.length < DEGRADATION_MIN_N || lateIdx.length < DEGRADATION_MIN_N)
    return out;

  for (const metric of eligibleMetrics(sourceFps)) {
    const early = summarise(
      valuesOf(
        earlyIdx.map((i) => shots[i]),
        metric,
      ),
      isRatioScale(metric),
    );
    const late = summarise(
      valuesOf(
        lateIdx.map((i) => shots[i]),
        metric,
      ),
      isRatioScale(metric),
    );
    if (!early || !late) continue;
    if (early.n < DEGRADATION_MIN_N || late.n < DEGRADATION_MIN_N) continue;

    // Relative change needs a stable denominator, so this is only computed for
    // metrics whose zero is a true origin.
    if (!isRatioScale(metric) || Math.abs(early.mean) < 1e-6) continue;
    const change = (late.mean - early.mean) / Math.abs(early.mean);
    if (Math.abs(change) < DEGRADATION_CHANGE) continue;

    const { label, unit, dp } = KINEMATIC_LABELS[metric];
    out.push({
      id: `${player}-degrade-${metric}`,
      player,
      kind: "rally_degradation",
      severity: "warn",
      metric,
      shotClass: "attack",
      headline: `${label} ${change < 0 ? "drops" : "rises"} ${pct(Math.abs(change))} in long rallies`,
      detail: `Shots 1–3 average ${early.mean.toFixed(dp)} ${unit} · shots 6+ average ${late.mean.toFixed(dp)} ${unit}`,
      evidence: {
        sampleSize: early.n + late.n,
        // The comparison here is early-vs-late, so the "extreme" side is the
        // late shots furthest from the early mean.
        ...(() => {
          const ev = pickEvidence(shots, lateIdx, metric, early.mean);
          return {
            extremeShots: ev.extremeShots,
            typicalShots: pickEvidence(shots, earlyIdx, metric, early.mean)
              .typicalShots,
          };
        })(),
      },
      score: Math.abs(change) * Math.log(early.n + late.n),
    });
  }

  return out;
}

/**
 * Rule 3 — strength.
 *
 * Serve is the most reliable class (0.974 precision), the most repeatable
 * action in the sport, and the most-coached element. A serve *should* be
 * identical every time, so its variance needs no external reference.
 */
function strengthFinding(
  shots: Shot[],
  player: Player,
  sourceFps: number,
): Finding | null {
  const indices = indicesOf(shots, player, "serve");
  if (indices.length < STRENGTH_MIN_N) return null;
  const subset = indices.map((i) => shots[i]);

  const cvs: number[] = [];
  let worst: { metric: KinematicKey; stat: Stat } | null = null;

  for (const metric of eligibleMetrics(sourceFps)) {
    const stat = summarise(valuesOf(subset, metric), isRatioScale(metric));
    if (!stat || stat.n < STRENGTH_MIN_N) continue;
    const v = variability(metric, stat);
    cvs.push(v);
    if (!worst || v > variability(worst.metric, worst.stat)) {
      worst = { metric, stat };
    }
  }

  if (cvs.length === 0) return null;
  const meanCv = cvs.reduce((a, b) => a + b, 0) / cvs.length;
  if (meanCv >= STRENGTH_CV) return null;

  return {
    id: `${player}-strength-serve`,
    player,
    kind: "strength",
    severity: "good",
    metric: worst?.metric ?? "backswing_amplitude",
    shotClass: "serve",
    headline: `Serve is highly repeatable (±${Math.round(meanCv * 100)}%)`,
    detail: "Consistent across every measured element of the action.",
    evidence: {
      sampleSize: indices.length,
      ...pickEvidence(
        shots,
        indices,
        worst?.metric ?? "backswing_amplitude",
        worst?.stat.mean ?? 0,
      ),
    },
    score: (STRENGTH_CV - meanCv) * Math.log(indices.length),
  };
}

/* ------------------------------------------------------------------ main -- */

/**
 * All findings for one player, ranked and capped.
 *
 * Returns an empty array when nothing clears the thresholds. That is a genuine
 * answer, not a failure — a tool that always finds three problems is guessing.
 */
export function computeFindings(
  shots: Shot[],
  player: Player,
  sourceFps: number,
): Finding[] {
  const warnings = [
    ...inconsistencyFindings(shots, player, sourceFps),
    ...degradationFindings(shots, player, sourceFps),
  ].sort((a, b) => b.score - a.score);

  const strength = strengthFinding(shots, player, sourceFps);

  // At most one `good`, so the list reinforces rather than pads.
  const picked = warnings.slice(
    0,
    strength ? MAX_PER_PLAYER - 1 : MAX_PER_PLAYER,
  );
  const all = strength ? [...picked, strength] : picked;

  // The top-ranked warning earns the extra line of context.
  if (all[0] && all[0].severity === "warn" && !all[0].detail) {
    all[0] = {
      ...all[0],
      detail: "The least consistent element of their game.",
    };
  }

  return all;
}

/** Count of shots whose label is reliable enough to base advice on. */
export function reliableShotCount(shots: Shot[], player: Player): number {
  return shots.filter((s) => s.player === player && !s.abstain).length;
}

/**
 * Whether any rule could even have fired for this player.
 *
 * Distinguishing "we looked and found nothing" from "we never had enough shots
 * to look" matters: the first is a claim about the player, the second is a
 * claim about the clip. Saying the first when the second is true tells a coach
 * their technique is consistent on the strength of nine attacks.
 */
export function hasEnoughDataForFindings(
  shots: Shot[],
  player: Player,
): boolean {
  const of = (cls: ShotClass) =>
    shots.filter((s) => s.player === player && s.shot_class === cls);

  const attacks = of("attack");
  const serves = of("serve");

  if (attacks.length >= INCONSISTENCY_MIN_N) return true;
  if (serves.length >= INCONSISTENCY_MIN_N) return true;
  if (serves.length >= STRENGTH_MIN_N) return true;

  const early = attacks.filter((s) => s.shot_index <= EARLY_MAX_INDEX).length;
  const late = attacks.filter((s) => s.shot_index >= LATE_MIN_INDEX).length;
  return early >= DEGRADATION_MIN_N && late >= DEGRADATION_MIN_N;
}

/** The honest empty-state line for a player with no findings. */
export function emptyFindingsMessage(
  shots: Shot[],
  player: Player,
  reliable: number,
): string {
  if (!hasEnoughDataForFindings(shots, player)) {
    const usable = shots.filter(
      (s) =>
        s.player === player &&
        (s.shot_class === "attack" || s.shot_class === "serve"),
    ).length;
    return `Not enough shots to draw a conclusion for the ${player} player — ${usable} serve${usable === 1 ? "" : "s"} and attack${usable === 1 ? "" : "s"} in this clip, where at least ${INCONSISTENCY_MIN_N} of a single type are needed. This is a limit of the clip, not a verdict on the player.`;
  }
  return `Nothing stands out for the ${player} player. Technique is consistent across the ${reliable} reliable shots in this match.`;
}
