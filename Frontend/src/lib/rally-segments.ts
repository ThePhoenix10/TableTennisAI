import type { Rally } from "./analysis";

/**
 * "Rallies only" — playing the match with the dead air between points removed.
 *
 * `game_1` is 180 seconds of video containing about 19 seconds of rallies, so
 * most of a straight playthrough is players walking back to the table. This
 * builds the playable spans and maps between two clocks:
 *
 *   - SOURCE time — where the video actually is. Everything else in the app
 *     (shot timestamps, seeking, the crop track) speaks this.
 *   - COMPRESSED time — position within the rallies alone, gaps excluded. Only
 *     the transport readout and the timeline layout speak this.
 *
 * Nothing downstream of `toSource` ever needs to know the mode is on.
 */

export interface Segment {
  start: number;
  end: number;
  /** The first rally in this span; spans may merge several. */
  rallyId: number;
}

/**
 * A rally span runs from its first contact to its last, which clips the serve
 * toss and the ball still being live after the final shot. These pad it back
 * out so a segment plays as a point rather than a fragment.
 */
export const RALLY_LEAD_IN_S = 1.5;
export const RALLY_LEAD_OUT_S = 2;

/**
 * Boundary slack, matching the seek tolerance elsewhere: a `<video>` asked to
 * seek to a segment start lands a few milliseconds early, and without slack it
 * would read as outside the segment and be skipped forward again — forever.
 */
const EDGE_TOLERANCE_S = 1 / 30;

/** Padded, clamped, merged and ordered playable spans. */
export function buildSegments(rallies: Rally[], duration: number): Segment[] {
  if (rallies.length === 0 || duration <= 0) return [];

  const padded = rallies
    .map((rally) => ({
      start: Math.max(0, rally.start_s - RALLY_LEAD_IN_S),
      end: Math.min(duration, rally.end_s + RALLY_LEAD_OUT_S),
      rallyId: rally.id,
    }))
    .sort((a, b) => a.start - b.start);

  // Padding can make neighbouring rallies overlap in a fast match; merging
  // keeps the mapping monotonic, which both conversions rely on.
  const merged: Segment[] = [];
  for (const span of padded) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

export function segmentsDuration(segments: Segment[]): number {
  return segments.reduce((total, s) => total + (s.end - s.start), 0);
}

/** Source time → position within the rallies alone. */
export function toCompressed(segments: Segment[], sourceTime: number): number {
  let elapsed = 0;
  for (const s of segments) {
    if (sourceTime < s.start) return elapsed;
    if (sourceTime <= s.end) return elapsed + (sourceTime - s.start);
    elapsed += s.end - s.start;
  }
  return elapsed;
}

/** Position within the rallies → the source time to seek to. */
export function toSource(segments: Segment[], compressed: number): number {
  let elapsed = 0;
  for (const s of segments) {
    const length = s.end - s.start;
    if (compressed <= elapsed + length) {
      return s.start + Math.max(0, compressed - elapsed);
    }
    elapsed += length;
  }
  return segments.length ? segments[segments.length - 1].end : 0;
}

/** The playable span containing `sourceTime`, or null in dead air. */
export function segmentAt(
  segments: Segment[],
  sourceTime: number,
): Segment | null {
  return (
    segments.find(
      (s) =>
        sourceTime >= s.start - EDGE_TOLERANCE_S &&
        sourceTime <= s.end + EDGE_TOLERANCE_S,
    ) ?? null
  );
}

export function isInSegment(segments: Segment[], sourceTime: number): boolean {
  return segments.some(
    (s) =>
      sourceTime >= s.start - EDGE_TOLERANCE_S &&
      sourceTime <= s.end + EDGE_TOLERANCE_S,
  );
}

/** Start of the next span after `sourceTime`, or null if none remain. */
export function nextSegmentStart(
  segments: Segment[],
  sourceTime: number,
): number | null {
  for (const s of segments) {
    if (s.start > sourceTime + EDGE_TOLERANCE_S) return s.start;
  }
  return null;
}
