import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shotIndexAt, summarise } from "./analysis";
import { computeFindings, EXCLUDED_CLASSES } from "./findings";
import type { Shot, ShotClass } from "./types";

/* ------------------------------------------------------------- fixtures -- */

let seq = 0;

/** A shot with sane defaults; override only what a test cares about. */
function shot(over: Partial<Shot> = {}): Shot {
  seq += 1;
  return {
    rally_id: 0,
    shot_index: 0,
    player: "left",
    frame: seq * 60,
    timestamp_s: seq,
    shot_class: "attack",
    class_confidence: 0.9,
    technique: "loop",
    abstain: false,
    detect_confidence: 0.9,
    backswing_amplitude: 1.2,
    peak_wrist_speed: 0.23,
    time_to_peak: -2,
    contact_height: 0.09,
    elbow_angle: 104,
    elbow_range: 88,
    trunk_lean: 14,
    trunk_rotation: 58,
    table_distance: 1.35,
    stance_width: 1.24,
    knee_angle: 141,
    follow_through: 1.02,
    recovery_time: 31,
    rally_length: 6,
    pose_confidence: 0.9,
    detected: 0.98,
    ...over,
  };
}

/** n shots of a class whose `metric` alternates around `mean` by ±spread. */
function varying(
  n: number,
  metric: keyof Shot,
  mean: number,
  spread: number,
  over: Partial<Shot> = {},
): Shot[] {
  return Array.from({ length: n }, (_, i) =>
    shot({ ...over, [metric]: mean + (i % 2 === 0 ? spread : -spread) }),
  );
}

/* ---------------------------------------------------------------- tests -- */

describe("summarise", () => {
  it("returns null for no values", () => {
    assert.equal(summarise([]), null);
  });

  it("computes sample sd, not population sd", () => {
    const s = summarise([2, 4, 4, 4, 5, 5, 7, 9])!;
    assert.equal(s.mean, 5);
    // Population sd is 2; sample sd (n-1) is ~2.138.
    assert.ok(Math.abs(s.sd - 2.138) < 0.001, `sd was ${s.sd}`);
  });

  it("suppresses CV when the mean sits near zero", () => {
    // Contact height: measured 0.10 ± 0.17 would print as ±177%.
    const s = summarise([0.3, -0.1, 0.25, -0.15, 0.2], true)!;
    assert.equal(s.cv, null, "CV must be null when the mean is unstable");
    assert.ok(s.sd > 0);
  });

  it("suppresses CV for interval-scale metrics even with a large mean", () => {
    const s = summarise([100, 102, 98, 101], false)!;
    assert.equal(s.cv, null);
  });

  it("computes CV for a well-behaved ratio-scale metric", () => {
    const s = summarise([10, 12, 8, 10], true)!;
    assert.ok(s.cv !== null && s.cv > 0.1 && s.cv < 0.25, `cv ${s.cv}`);
  });
});

describe("computeFindings — rule 1, inconsistency", () => {
  it("fires above the CV threshold with enough shots", () => {
    // backswing 1.2 ± 0.36 => CV 0.30, over the 0.20 threshold.
    const shots = varying(20, "backswing_amplitude", 1.2, 0.36);
    const f = computeFindings(shots, "left", 120);
    const hit = f.find((x) => x.metric === "backswing_amplitude");
    assert.ok(hit, "expected a backswing finding");
    assert.equal(hit.kind, "inconsistency");
    assert.equal(hit.severity, "warn");
    // Sample sd over 20 alternating values is 0.36·√(20/19), so CV is ~0.308.
    assert.match(hit.headline, /±31%/);
    assert.equal(hit.evidence.sampleSize, 20);
  });

  it("stays silent below the CV threshold", () => {
    // CV 0.05 — well inside tolerance.
    const shots = varying(20, "backswing_amplitude", 1.2, 0.06);
    const f = computeFindings(shots, "left", 120);
    assert.equal(
      f.filter((x) => x.kind === "inconsistency").length,
      0,
      "consistent technique must not produce a finding",
    );
  });

  it("stays silent below the sample-size floor", () => {
    // Same wild variance, but only 14 shots.
    const shots = varying(14, "backswing_amplitude", 1.2, 0.36);
    const f = computeFindings(shots, "left", 120);
    assert.equal(f.filter((x) => x.kind === "inconsistency").length, 0);
  });

  it("never quotes a percentage for an interval-scale metric", () => {
    const shots = varying(20, "contact_height", 0.05, 0.25);
    const f = computeFindings(shots, "left", 120);
    const hit = f.find((x) => x.metric === "contact_height");
    if (hit) {
      assert.doesNotMatch(
        hit.headline,
        /±\d{3,}%/,
        `nonsense percentage in "${hit.headline}"`,
      );
      assert.match(hit.headline, /torso/);
    }
  });

  it("does not mix classes", () => {
    // Serves are tight, attacks are wild. Pooled they would look moderate;
    // per-class the attack finding must survive on its own.
    const shots = [
      ...varying(20, "backswing_amplitude", 1.2, 0.36, {
        shot_class: "attack",
      }),
      ...varying(20, "backswing_amplitude", 0.72, 0.01, {
        shot_class: "serve",
      }),
    ];
    const f = computeFindings(shots, "left", 120);
    const hit = f.find(
      (x) => x.metric === "backswing_amplitude" && x.kind === "inconsistency",
    );
    assert.ok(hit);
    assert.equal(hit.shotClass, "attack");
    assert.equal(hit.evidence.sampleSize, 20, "must not pool the 40 shots");
  });
});

describe("computeFindings — rule 2, rally degradation", () => {
  it("detects a drop between early and late rally shots", () => {
    const early = Array.from({ length: 15 }, () =>
      shot({ shot_index: 1, backswing_amplitude: 1.3 }),
    );
    const late = Array.from({ length: 15 }, () =>
      shot({ shot_index: 6, backswing_amplitude: 1.0 }),
    );
    const f = computeFindings([...early, ...late], "left", 120);
    const hit = f.find((x) => x.kind === "rally_degradation");
    assert.ok(hit, "expected a degradation finding");
    assert.match(hit.headline, /drops/);
    assert.match(hit.headline, /23%/);
    assert.equal(hit.shotClass, "attack");
  });

  it("stays silent when the change is under 15%", () => {
    const early = Array.from({ length: 15 }, () =>
      shot({ shot_index: 1, backswing_amplitude: 1.2 }),
    );
    const late = Array.from(
      { length: 15 },
      () => shot({ shot_index: 6, backswing_amplitude: 1.14 }), // 5%
    );
    const f = computeFindings([...early, ...late], "left", 120);
    assert.equal(f.filter((x) => x.kind === "rally_degradation").length, 0);
  });

  it("stays silent without enough shots on both sides", () => {
    const early = Array.from({ length: 15 }, () =>
      shot({ shot_index: 1, backswing_amplitude: 1.3 }),
    );
    const late = Array.from({ length: 4 }, () =>
      shot({ shot_index: 6, backswing_amplitude: 1.0 }),
    );
    const f = computeFindings([...early, ...late], "left", 120);
    assert.equal(f.filter((x) => x.kind === "rally_degradation").length, 0);
  });
});

describe("computeFindings — rule 3, strength", () => {
  it("fires on a highly repeatable serve", () => {
    const shots = Array.from({ length: 15 }, (_, i) =>
      shot({
        shot_class: "serve",
        technique: "serve",
        backswing_amplitude: 0.72 + (i % 2 ? 0.005 : -0.005),
      }),
    );
    const f = computeFindings(shots, "left", 120);
    const hit = f.find((x) => x.kind === "strength");
    assert.ok(hit, "expected a strength finding");
    assert.equal(hit.severity, "good");
    assert.match(hit.headline, /repeatable/);
  });

  it("returns at most one good finding", () => {
    const shots = Array.from({ length: 30 }, () =>
      shot({ shot_class: "serve", technique: "serve" }),
    );
    const f = computeFindings(shots, "left", 120);
    assert.ok(f.filter((x) => x.severity === "good").length <= 1);
  });
});

describe("computeFindings — exclusions and capping", () => {
  it("excludes control and defence entirely", () => {
    for (const cls of EXCLUDED_CLASSES) {
      const shots = varying(40, "backswing_amplitude", 1.2, 0.5, {
        shot_class: cls as ShotClass,
      });
      const f = computeFindings(shots, "left", 120);
      assert.equal(
        f.length,
        0,
        `${cls} must never produce a finding (precision is too low)`,
      );
    }
  });

  it("returns an empty array when nothing clears the thresholds", () => {
    const shots = Array.from({ length: 40 }, () => shot());
    assert.deepEqual(computeFindings(shots, "left", 120), []);
  });

  it("caps at three per player", () => {
    const shots = [
      ...varying(20, "backswing_amplitude", 1.2, 0.4),
      ...varying(20, "elbow_angle", 104, 40),
      ...varying(20, "trunk_rotation", 58, 25),
      ...varying(20, "table_distance", 1.35, 0.5),
      ...varying(20, "stance_width", 1.24, 0.5),
    ];
    assert.ok(computeFindings(shots, "left", 120).length <= 3);
  });

  it("ranks the strongest effect first and annotates it", () => {
    const shots = [
      ...varying(20, "backswing_amplitude", 1.2, 0.5), // CV 0.42
      ...varying(20, "table_distance", 1.35, 0.31), // CV 0.23
    ];
    const f = computeFindings(shots, "left", 120);
    assert.equal(f[0].metric, "backswing_amplitude");
    assert.match(f[0].detail, /least consistent/);
  });

  it("only returns findings for the requested player", () => {
    const shots = [
      ...varying(20, "backswing_amplitude", 1.2, 0.4, { player: "left" }),
      ...varying(20, "backswing_amplitude", 1.2, 0.4, { player: "right" }),
    ];
    const f = computeFindings(shots, "right", 120);
    assert.ok(f.length > 0);
    assert.ok(f.every((x) => x.player === "right"));
    assert.equal(f[0].evidence.sampleSize, 20);
  });

  it("evidence indices address the full shot array", () => {
    const shots = [
      ...Array.from({ length: 5 }, () => shot({ player: "right" })),
      ...varying(20, "backswing_amplitude", 1.2, 0.4, { player: "left" }),
    ];
    const f = computeFindings(shots, "left", 120);
    const all = [...f[0].evidence.extremeShots, ...f[0].evidence.typicalShots];
    assert.ok(all.length > 0);
    for (const i of all) {
      assert.equal(
        shots[i].player,
        "left",
        `index ${i} points at wrong player`,
      );
    }
  });
});

describe("computeFindings — frame-rate gate", () => {
  it("never bases a finding on a velocity metric below 60fps", () => {
    const shots = varying(30, "peak_wrist_speed", 0.23, 0.12);
    const f = computeFindings(shots, "left", 30);
    assert.equal(
      f.filter((x) => x.metric === "peak_wrist_speed").length,
      0,
      "wrist speed is ~54% under-measured at 30fps",
    );
  });
});

describe("shotIndexAt — seek tolerance", () => {
  const at = (t: number) => t;
  const list = [
    shot({ timestamp_s: 16.883333333333333 }),
    shot({ timestamp_s: 17.566666666666666 }),
    shot({ timestamp_s: 27.125 }),
  ];

  it("selects nothing before the first shot", () => {
    assert.equal(shotIndexAt(list, at(5)), -1);
  });

  it("selects a shot when the video lands a few ms early", () => {
    // A real seek to 16.8833 reported 16.88 — without tolerance this was -1,
    // which broke arrow-key stepping entirely.
    assert.equal(shotIndexAt(list, at(16.88)), 0);
  });

  it("selects a shot at its exact timestamp", () => {
    assert.equal(shotIndexAt(list, at(16.883333333333333)), 0);
  });

  it("advances to the next shot once past it", () => {
    assert.equal(shotIndexAt(list, at(17.56)), 1);
    assert.equal(shotIndexAt(list, at(20)), 1);
    assert.equal(shotIndexAt(list, at(27.2)), 2);
  });

  it("does not reach forward past a genuinely later shot", () => {
    // 27.125 is far away; tolerance must not pull it in at 17.6.
    assert.equal(shotIndexAt(list, at(17.6)), 1);
  });
});
