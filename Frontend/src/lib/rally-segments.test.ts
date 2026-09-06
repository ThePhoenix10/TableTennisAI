import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Rally } from "./analysis";
import {
  buildSegments,
  isInSegment,
  nextSegmentStart,
  RALLY_LEAD_IN_S,
  RALLY_LEAD_OUT_S,
  segmentsDuration,
  toCompressed,
  toSource,
  type Segment,
} from "./rally-segments";

/** Only the span fields matter here. */
const rally = (id: number, start: number, end: number): Rally => ({
  id,
  shots: [],
  start_s: start,
  end_s: end,
  length: 0,
  server: "left",
});

/** Two 10s spans with a 30s gap: [10,20] and [50,60]. */
const SEGS: Segment[] = [
  { start: 10, end: 20, rallyId: 0 },
  { start: 50, end: 60, rallyId: 1 },
];

describe("buildSegments", () => {
  it("pads each rally on both sides", () => {
    const [s] = buildSegments([rally(0, 30, 40)], 180);
    assert.equal(s.start, 30 - RALLY_LEAD_IN_S);
    assert.equal(s.end, 40 + RALLY_LEAD_OUT_S);
  });

  it("clamps padding to the video bounds", () => {
    const segs = buildSegments([rally(0, 0.2, 1), rally(1, 178, 179.8)], 180);
    assert.equal(segs[0].start, 0);
    assert.equal(segs[segs.length - 1].end, 180);
  });

  it("merges spans that overlap once padded", () => {
    // 1s apart, so lead-in and lead-out collide.
    const segs = buildSegments([rally(0, 10, 11), rally(1, 12, 13)], 180);
    assert.equal(segs.length, 1, "adjacent rallies must merge into one span");
    assert.ok(segs[0].start <= 10 && segs[0].end >= 13);
  });

  it("keeps distant rallies separate", () => {
    assert.equal(
      buildSegments([rally(0, 10, 11), rally(1, 90, 95)], 180).length,
      2,
    );
  });

  it("handles a zero-length rally (a single shot)", () => {
    const [s] = buildSegments([rally(0, 100, 100)], 180);
    assert.ok(s.end - s.start > 0, "a one-shot rally must still be playable");
  });

  it("returns nothing without rallies or duration", () => {
    assert.deepEqual(buildSegments([], 180), []);
    assert.deepEqual(buildSegments([rally(0, 1, 2)], 0), []);
  });
});

describe("toCompressed", () => {
  it("is zero before the first span", () => {
    assert.equal(toCompressed(SEGS, 0), 0);
    assert.equal(toCompressed(SEGS, 10), 0);
  });

  it("advances within a span", () => {
    assert.equal(toCompressed(SEGS, 15), 5);
    assert.equal(toCompressed(SEGS, 20), 10);
  });

  it("does not advance across a gap", () => {
    // The whole 30s gap collapses to a single point.
    assert.equal(toCompressed(SEGS, 21), 10);
    assert.equal(toCompressed(SEGS, 49), 10);
  });

  it("continues into the next span", () => {
    assert.equal(toCompressed(SEGS, 55), 15);
  });

  it("saturates past the last span", () => {
    assert.equal(toCompressed(SEGS, 180), 20);
  });
});

describe("toSource", () => {
  it("maps back into the right span", () => {
    assert.equal(toSource(SEGS, 0), 10);
    assert.equal(toSource(SEGS, 5), 15);
    assert.equal(toSource(SEGS, 15), 55);
  });

  it("never lands in a gap", () => {
    const total = segmentsDuration(SEGS);
    for (let c = 0; c <= total; c += 0.25) {
      const t = toSource(SEGS, c);
      assert.ok(
        isInSegment(SEGS, t),
        `compressed ${c} mapped to ${t}, which is dead air`,
      );
    }
  });

  it("round-trips with toCompressed", () => {
    for (let c = 0; c <= segmentsDuration(SEGS); c += 0.5) {
      assert.ok(
        Math.abs(toCompressed(SEGS, toSource(SEGS, c)) - c) < 1e-9,
        `round trip failed at ${c}`,
      );
    }
  });

  it("clamps past the end", () => {
    assert.equal(toSource(SEGS, 999), 60);
  });
});

describe("segmentsDuration", () => {
  it("sums only the playable spans", () => {
    assert.equal(segmentsDuration(SEGS), 20);
    assert.equal(segmentsDuration([]), 0);
  });
});

describe("isInSegment / nextSegmentStart", () => {
  it("accepts the exact boundaries", () => {
    assert.equal(isInSegment(SEGS, 10), true);
    assert.equal(isInSegment(SEGS, 20), true);
  });

  it("tolerates a seek landing a few ms short of a start", () => {
    // Without slack this re-triggers the skip forever.
    assert.equal(isInSegment(SEGS, 9.99), true);
  });

  it("rejects the middle of a gap", () => {
    assert.equal(isInSegment(SEGS, 35), false);
  });

  it("finds the next span from a gap", () => {
    assert.equal(nextSegmentStart(SEGS, 0), 10);
    assert.equal(nextSegmentStart(SEGS, 35), 50);
  });

  it("returns null past the last span", () => {
    assert.equal(nextSegmentStart(SEGS, 100), null);
  });

  it("does not treat the current start as the next one", () => {
    // Otherwise the skip effect seeks to where it already is, forever.
    assert.equal(nextSegmentStart(SEGS, 10), 50);
  });
});
