/**
 * Generates the demo fixtures described in PONGAI_FRONTEND_SPEC.md §13.
 *
 * There is no backend yet, so this synthesises statistically plausible data:
 * realistic rally structure, a class mix that reflects the model's measured
 * behaviour, and kinematics drawn from per-player distributions so the
 * consistency block (addendum §3.5) has something real to measure.
 *
 * THE NUMBERS ARE INVENTED. They exercise the UI; they describe no real match.
 *
 * Deterministic: a seeded PRNG means the same fixtures every run, so a diff in
 * the UI is never a diff in the data. Output is gitignored and regenerated on
 * `predev` / `prebuild`.
 *
 *   node scripts/generate-demo-data.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "demo",
);

/* Kept in sync with src/lib/constants.ts. */
const WINDOW_FRAMES = 97;
const CONTACT_INDEX = 60;
const KEYPOINT_COUNT = 17;
/** Int16 quantisation: coords are torso-lengths in roughly ±8. */
const POSE_SCALE = 4000;

/* ---------------------------------------------------------------- PRNG --- */

/** mulberry32 — small, fast, good enough for fixtures, and seedable. */
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Uniform in [min, max). */
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    /** Box–Muller, so kinematics cluster around a mean like real measurements. */
    normal(mean, sd) {
      const u = Math.max(next(), 1e-9);
      const v = next();
      return (
        mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
      );
    },
    /** Picks a key from a {key: weight} map. */
    weighted(weights) {
      const entries = Object.entries(weights);
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [key, w] of entries) {
        roll -= w;
        if (roll <= 0) return key;
      }
      return entries[entries.length - 1][0];
    },
  };
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round = (v, dp = 3) => Number(v.toFixed(dp));

/* ------------------------------------------------------------ profiles --- */

/**
 * Per-class kinematic centres, as [mean, sd] in the units from spec §3.
 * `sd` here is the *population* spread; each player then gets their own
 * consistency multiplier, which is what §3.5 actually visualises.
 */
const CLASS_KINEMATICS = {
  serve: {
    backswing_amplitude: [0.72, 0.09],
    contact_height: [-0.12, 0.06],
    elbow_angle: [128, 9],
    elbow_range: [54, 8],
    trunk_lean: [7, 3],
    trunk_rotation: [34, 7],
    table_distance: [0.55, 0.12],
    stance_width: [1.02, 0.1],
    knee_angle: [156, 7],
    peak_wrist_speed: [0.146, 0.021],
    time_to_peak: [-3.1, 1.4],
    follow_through: [0.61, 0.1],
    recovery_time: [22, 5],
  },
  attack: {
    backswing_amplitude: [1.24, 0.16],
    contact_height: [0.09, 0.09],
    elbow_angle: [104, 12],
    elbow_range: [88, 12],
    trunk_lean: [14, 5],
    trunk_rotation: [58, 11],
    table_distance: [1.35, 0.32],
    stance_width: [1.24, 0.13],
    knee_angle: [141, 9],
    peak_wrist_speed: [0.231, 0.034],
    time_to_peak: [-2.2, 1.1],
    follow_through: [1.02, 0.16],
    recovery_time: [31, 7],
  },
  control: {
    backswing_amplitude: [0.61, 0.11],
    contact_height: [-0.04, 0.07],
    elbow_angle: [118, 11],
    elbow_range: [41, 9],
    trunk_lean: [9, 4],
    trunk_rotation: [27, 8],
    table_distance: [0.78, 0.21],
    stance_width: [1.09, 0.11],
    knee_angle: [149, 8],
    peak_wrist_speed: [0.118, 0.019],
    time_to_peak: [-2.6, 1.3],
    follow_through: [0.48, 0.09],
    recovery_time: [24, 6],
  },
  defence: {
    backswing_amplitude: [0.94, 0.19],
    contact_height: [-0.22, 0.11],
    elbow_angle: [132, 13],
    elbow_range: [63, 13],
    trunk_lean: [11, 5],
    trunk_rotation: [38, 10],
    table_distance: [2.15, 0.44],
    stance_width: [1.18, 0.14],
    knee_angle: [146, 10],
    peak_wrist_speed: [0.163, 0.028],
    time_to_peak: [-3.4, 1.6],
    follow_through: [0.79, 0.14],
    recovery_time: [36, 9],
  },
};

const DEGREE_KEYS = new Set([
  "elbow_angle",
  "elbow_range",
  "trunk_lean",
  "trunk_rotation",
  "knee_angle",
]);

/**
 * Calibrated confidence, centred on the class's measured precision (spec §1)
 * so the displayed numbers stay consistent with the reliability story.
 */
const CLASS_PRECISION = {
  serve: 0.974,
  attack: 0.857,
  control: 0.804,
  defence: 0.556,
};

/** A shot is abstained when the model is not confident enough to be quoted. */
const ABSTAIN_BELOW = 0.62;

/* ------------------------------------------------------------- poses ----- */

/**
 * A neutral COCO-17 pose in the canonical space the UI renders in:
 * hip-centred, torso-scaled (shoulder-to-hip = 1), +y downward.
 */
const REST_POSE = [
  [0.0, -1.46], // 0  nose
  [-0.06, -1.5], // 1  L eye
  [0.06, -1.5], // 2  R eye
  [-0.12, -1.46], // 3  L ear
  [0.12, -1.46], // 4  R ear
  [-0.22, -1.0], // 5  L shoulder
  [0.22, -1.0], // 6  R shoulder
  [-0.42, -0.62], // 7  L elbow
  [0.42, -0.62], // 8  R elbow
  [-0.5, -0.24], // 9  L wrist
  [0.5, -0.24], // 10 R wrist
  [-0.18, 0.0], // 11 L hip
  [0.18, 0.0], // 12 R hip
  [-0.2, 0.62], // 13 L knee
  [0.2, 0.62], // 14 R knee
  [-0.22, 1.26], // 15 L ankle
  [0.22, 1.26], // 16 R ankle
];

const UPPER_ARM = 0.44;
const FOREARM = 0.42;

/**
 * Synthesises one 97-frame swing. The arm sweeps back, accelerates through
 * contact at frame 60, then decelerates into the follow-through — so the
 * wrist-speed trace the UI derives from this has a peak in the right place.
 */
function synthesiseWindow(shot, rng) {
  const out = new Float32Array(WINDOW_FRAMES * KEYPOINT_COUNT * 2);

  const amplitude = shot.backswing_amplitude;
  const reach = clamp(shot.follow_through, 0.3, 1.6);
  const lean = (shot.trunk_lean * Math.PI) / 180;
  const jitter = 0.006;

  for (let f = 0; f < WINDOW_FRAMES; f += 1) {
    // Swing phase: -1 at full backswing, 0 at contact, +1 at end of follow-through.
    const t = (f - CONTACT_INDEX) / CONTACT_INDEX;
    // Backswing peaks ~frame 24, contact at 60, recovery after ~85.
    const swing = Math.sin((Math.PI * (f - 12)) / 72);
    const phase = clamp(swing, -1, 1);

    // Shoulder angle sweeps through the stroke; elbow extends into contact.
    const shoulderAngle = -0.55 * Math.PI + phase * 0.62 * amplitude;
    const elbowFlex =
      ((shot.elbow_angle + shot.elbow_range * 0.5 * phase) * Math.PI) / 180;

    const bodyTwist = phase * (shot.trunk_rotation / 180) * 0.22;
    const bob = 0.03 * Math.cos((Math.PI * f) / 48);

    for (let k = 0; k < KEYPOINT_COUNT; k += 1) {
      let [x, y] = REST_POSE[k];

      // Trunk rotation compresses horizontally; lean shears the upper body.
      const heightAboveHip = Math.max(0, -y);
      x = x * (1 - Math.abs(bodyTwist) * 0.35) + bodyTwist * heightAboveHip;
      x += Math.sin(lean) * heightAboveHip * 0.12;
      y += bob * (heightAboveHip > 0.3 ? 1 : 0.3);

      // Drive the playing arm (right side: shoulder 6 → elbow 8 → wrist 10).
      if (k === 8 || k === 10) {
        const [sx, sy] = REST_POSE[6];
        const ex = sx + Math.cos(shoulderAngle) * UPPER_ARM * reach;
        const ey = sy + Math.sin(shoulderAngle) * UPPER_ARM * reach;
        if (k === 8) {
          x = ex + bodyTwist * 0.6;
          y = ey + bob;
        } else {
          const wristAngle = shoulderAngle + (Math.PI - elbowFlex);
          x = ex + Math.cos(wristAngle) * FOREARM * reach + bodyTwist * 0.9;
          y = ey + Math.sin(wristAngle) * FOREARM * reach + bob;
          // Contact height is measured relative to the shoulder line.
          y += shot.contact_height * Math.exp(-Math.abs(t) * 6) * -1;
        }
      }

      out[(f * KEYPOINT_COUNT + k) * 2] = x + rng.normal(0, jitter);
      out[(f * KEYPOINT_COUNT + k) * 2 + 1] = y + rng.normal(0, jitter);
    }
  }

  return out;
}

/* -------------------------------------------------------------- shots ---- */

function makeShot(
  rng,
  { rallyId, shotIndex, player, timestamp, fps, style, rallyLength },
) {
  const isServe = shotIndex === 0;
  const shotClass = isServe ? "serve" : rng.weighted(style.mix);

  // Calibrated confidence: centred on the class precision, clipped to [0,1].
  const confidence = clamp(
    rng.normal(CLASS_PRECISION[shotClass], 0.13),
    0.18,
    0.995,
  );
  // Serves and attacks are reliable enough that abstention is rare.
  const abstain =
    confidence < ABSTAIN_BELOW &&
    (shotClass === "control" || shotClass === "defence");

  const shot = {
    rally_id: rallyId,
    shot_index: shotIndex,
    player,
    frame: Math.round(timestamp * fps),
    timestamp_s: round(timestamp, 3),
    shot_class: shotClass,
    class_confidence: round(confidence, 3),
    technique: pickTechnique(rng, shotClass),
    abstain,
    detect_confidence: round(clamp(rng.normal(0.91, 0.06), 0.4, 0.999), 3),
    rally_length: rallyLength,
    pose_confidence: round(clamp(rng.normal(0.88, 0.07), 0.35, 0.999), 3),
    detected: round(clamp(rng.normal(0.96, 0.05), 0.5, 1), 3),
  };

  // Attacks late in a rally drift from attacks early in it — the effect rule 2
  // looks for. Ramps linearly from shot_index 2 to 8, then holds.
  const driftProgress =
    shotClass === "attack" ? clamp((shotIndex - 2) / 6, 0, 1) : 0;

  const centres = CLASS_KINEMATICS[shotClass];
  for (const [key, [mean, sd]] of Object.entries(centres)) {
    // The player's consistency multiplier is what §3.5 surfaces as CV.
    const tightness =
      isServe && style.serveConsistency !== undefined
        ? style.serveConsistency
        : (style.consistency[key] ?? style.consistencyDefault);
    const drifted = mean * (1 + (style.rallyDrift?.[key] ?? 0) * driftProgress);
    let value = rng.normal(drifted, sd * tightness);
    if (DEGREE_KEYS.has(key)) value = clamp(value, 5, 179);
    shot[key] = round(value, DEGREE_KEYS.has(key) ? 1 : 3);
  }

  // time_to_peak and recovery_time are frame counts and may be absent when the
  // window runs past the end of the clip.
  shot.time_to_peak = rng.next() < 0.04 ? null : Math.round(shot.time_to_peak);
  shot.recovery_time =
    rng.next() < 0.06 ? null : Math.round(shot.recovery_time);

  return shot;
}

const TECHNIQUES = {
  serve: { serve: 1 },
  attack: { loop: 6, smash: 2, flick: 2 },
  control: { push: 5, block: 4 },
  defence: { chop: 5, block: 2, lob: 1 },
};

const pickTechnique = (rng, shotClass) => rng.weighted(TECHNIQUES[shotClass]);

/* ------------------------------------------------------------ matches ---- */

/**
 * Two contrasting styles per match, so the analytics panels have something to
 * distinguish. `consistency` multiplies the population spread per metric.
 */
const STYLES = {
  attacker: {
    mix: { attack: 0.56, control: 0.28, defence: 0.16 },
    consistencyDefault: 0.9,
    consistency: {
      backswing_amplitude: 0.7,
      contact_height: 1.9,
      elbow_angle: 0.6,
    },
    // Tightens every serve kinematic — this player owns the "strength" finding.
    serveConsistency: 0.45,
    // Relative drift applied linearly from shot_index 2 to 8 on attacks, so
    // rule 2 (rally degradation) has something real to detect.
    rallyDrift: { backswing_amplitude: -0.34 },
  },
  allRound: {
    mix: { attack: 0.4, control: 0.38, defence: 0.22 },
    consistencyDefault: 1.1,
    consistency: {
      backswing_amplitude: 1.35,
      contact_height: 1.3,
      trunk_rotation: 1.5,
    },
    serveConsistency: 1.0,
    rallyDrift: {},
  },
  chopper: {
    mix: { attack: 0.16, control: 0.24, defence: 0.6 },
    consistencyDefault: 0.85,
    consistency: {
      backswing_amplitude: 0.8,
      table_distance: 1.6,
      contact_height: 1.1,
    },
    serveConsistency: 0.9,
    rallyDrift: { table_distance: 0.24 },
  },
};

const MATCHES = [
  {
    id: "game_2",
    seed: 20250904,
    source_fps: 120,
    // Real ground truth: 399 strokes over 1,435 s. The "~800" in the original
    // spec was an estimate from duration and was wrong (revision 2 §8).
    duration_s: 1435,
    rallies: 87,
    mean_rally: 4.5, // 399 shots
    styles: ["attacker", "allRound"],
  },
  {
    id: "test_1",
    seed: 12345,
    source_fps: 120,
    duration_s: 122,
    rallies: 7,
    mean_rally: 12, // ~84 shots — chopper rallies run long
    styles: ["attacker", "chopper"],
  },
  // No synthetic `game_1`: a REAL exported match now owns that id, at
  // public/demo/game_1/. Generating one here would collide with it.
  {
    id: "game_4",
    seed: 40004,
    source_fps: 120,
    duration_s: 720,
    rallies: 30,
    mean_rally: 5.8, // ~173 shots, chop-heavy
    styles: ["chopper", "attacker"],
  },
  {
    id: "game_1_30fps",
    seed: 30030,
    source_fps: 30,
    duration_s: 305,
    rallies: 21,
    mean_rally: 7.6, // ~159 shots
    styles: ["allRound", "attacker"],
  },
];

function buildMatch(config) {
  const rng = makeRng(config.seed);
  const [leftStyle, rightStyle] = config.styles.map((s) => STYLES[s]);

  const shots = [];
  const windows = [];

  // Leave a margin at each end so the first and last rally are not clipped.
  const playable = config.duration_s * 0.94;
  const startOffset = config.duration_s * 0.03;
  const perRally = playable / config.rallies;

  for (let r = 0; r < config.rallies; r += 1) {
    // Rally length: short exchanges are common, long ones are the tail. The
    // half-normal has mean ~0.798σ, so σ is solved from the target mean.
    const tailSigma = Math.max(0.5, (config.mean_rally - 3.5) / 0.798);
    const rallyLength = clamp(
      Math.round(Math.abs(rng.normal(0, 1)) * tailSigma + rng.int(2, 5)),
      1,
      34,
    );
    // Rallies do not fill their slot; the remainder is the gap between points.
    const rallyDuration = Math.min(perRally * 0.62, rallyLength * 0.86);
    const rallyStart =
      startOffset + r * perRally + rng.range(0, perRally * 0.18);
    // The server alternates every two rallies, as in a real match.
    const server = Math.floor(r / 2) % 2 === 0 ? "left" : "right";

    for (let i = 0; i < rallyLength; i += 1) {
      const player =
        i % 2 === 0 ? server : server === "left" ? "right" : "left";
      const timestamp =
        rallyStart +
        (rallyLength === 1 ? 0 : (i / rallyLength) * rallyDuration);

      const shot = makeShot(rng, {
        rallyId: r,
        shotIndex: i,
        player,
        timestamp,
        fps: config.source_fps,
        style: player === "left" ? leftStyle : rightStyle,
        rallyLength,
      });

      shots.push(shot);
      windows.push(synthesiseWindow(shot, rng));
    }
  }

  return { shots, windows };
}

/** Packs every pose window into one Int16 buffer, quantised by POSE_SCALE. */
function packPoses(windows) {
  const perWindow = WINDOW_FRAMES * KEYPOINT_COUNT * 2;
  const packed = new Int16Array(windows.length * perWindow);
  windows.forEach((w, i) => {
    for (let j = 0; j < perWindow; j += 1) {
      packed[i * perWindow + j] = clamp(
        Math.round(w[j] * POSE_SCALE),
        -32768,
        32767,
      );
    }
  });
  return Buffer.from(packed.buffer);
}

/* --------------------------------------------------------------- main ---- */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const config of MATCHES) {
    const dims = { width: 1920, height: 1080 };
    const { shots, windows } = buildMatch(config);

    const analysis = {
      video_id: config.id,
      // No real footage exists yet; the UI drives playback from a synthetic
      // clock when this is empty. See src/lib/use-playback.ts.
      video_url: "",
      duration_s: config.duration_s,
      source_fps: config.source_fps,
      ...dims,
      poses_url: `/demo/${config.id}.poses.bin`,
      poses_scale: POSE_SCALE,
      synthetic: true,
      shots,
    };

    await writeFile(
      join(OUT_DIR, `${config.id}.json`),
      JSON.stringify(analysis),
    );
    const poses = packPoses(windows);
    await writeFile(join(OUT_DIR, `${config.id}.poses.bin`), poses);

    const rallies = new Set(shots.map((s) => s.rally_id)).size;
    const abstained = shots.filter((s) => s.abstain).length;
    console.log(
      `${config.id.padEnd(14)} ${String(shots.length).padStart(4)} shots · ` +
        `${String(rallies).padStart(3)} rallies · ${config.source_fps}fps · ` +
        `${abstained} abstained · poses ${(poses.length / 1e6).toFixed(1)}MB`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
