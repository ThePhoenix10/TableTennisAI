"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatClock } from "@/lib/analysis";
import type { Rally } from "@/lib/analysis";
import { SHOT_CLASS_META } from "@/lib/constants";
import {
  segmentsDuration,
  toCompressed,
  type Segment,
} from "@/lib/rally-segments";
import type { Shot } from "@/lib/types";

const TRACK_TOP = 10;
const TRACK_HEIGHT = 46;
const RALLY_BAND_TOP = 62;
const RALLY_BAND_HEIGHT = 8;
const CANVAS_HEIGHT = 78;

interface Props {
  shots: Shot[];
  rallies: Rally[];
  duration: number;
  time: number;
  selectedIndex: number;
  /** Indices that survive the current filters; others draw faint. */
  visible: Set<number> | null;
  onSelect: (index: number) => void;
  /**
   * When set, the track lays out on rally time with the gaps removed, matching
   * the transport. Null lays out on the full video duration.
   */
  segments: Segment[] | null;
}

/**
 * The primary navigation control — click a marker, the video seeks.
 *
 * A 24-minute match holds ~800 shots, so markers are drawn to a single canvas
 * rather than 800 DOM nodes (spec §6.1). Pointer events hit-test against the
 * same geometry; keyboard navigation is handled by the parent, which owns
 * selection.
 */
export function ShotTimeline({
  shots,
  rallies,
  duration,
  time,
  selectedIndex,
  visible,
  onSelect,
  segments,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Length of the track's own clock — compressed or full. */
  const trackDuration = useMemo(
    () => (segments ? segmentsDuration(segments) : duration),
    [segments, duration],
  );

  const xOf = useCallback(
    (seconds: number) => {
      if (!trackDuration) return 0;
      const t = segments ? toCompressed(segments, seconds) : seconds;
      return (t / trackDuration) * width;
    },
    [segments, trackDuration, width],
  );

  /** Nearest shot within a few pixels of `x`, or null. */
  const hitTest = useCallback(
    (x: number): number | null => {
      let best: number | null = null;
      let bestDistance = 8;
      shots.forEach((shot, i) => {
        const distance = Math.abs(xOf(shot.timestamp_s) - x);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      });
      return best;
    },
    [shots, xOf],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, CANVAS_HEIGHT);

    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();

    // Rally bands beneath the markers, so grouping is visible at a glance.
    ctx.fillStyle = token("--color-border");
    for (const rally of rallies) {
      const x = xOf(rally.start_s);
      const w = Math.max(2, xOf(rally.end_s) - x);
      ctx.fillRect(x, RALLY_BAND_TOP, w, RALLY_BAND_HEIGHT);
    }

    // Markers. Uncertain shots draw shorter and hatched so they never read
    // with the same weight as a confident one (spec §7.1).
    shots.forEach((shot, i) => {
      const x = Math.round(xOf(shot.timestamp_s)) + 0.5;
      const meta = SHOT_CLASS_META[shot.shot_class];
      const dimmed = visible !== null && !visible.has(i);
      const isSelected = i === selectedIndex;

      const height = shot.abstain ? TRACK_HEIGHT * 0.58 : TRACK_HEIGHT;
      const top = TRACK_TOP + (TRACK_HEIGHT - height);
      // Left player above the midline, right player below — player is
      // readable without relying on colour.
      const half = shot.player === "left" ? top : top + height / 2;
      const drawHeight = height / 2;

      ctx.globalAlpha = dimmed ? 0.16 : shot.abstain ? 0.55 : 1;
      ctx.fillStyle = token(meta.colorVar.replace(/^var\(|\)$/g, ""));
      ctx.fillRect(x - 1, half, isSelected ? 3 : 2, drawHeight);

      if (shot.abstain && !dimmed) {
        // Diagonal ticks — the hatch equivalent at marker scale.
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(x - 3, half + drawHeight * 0.35);
        ctx.lineTo(x + 3, half + drawHeight * 0.15);
        ctx.strokeStyle = token(meta.colorVar.replace(/^var\(|\)$/g, ""));
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });

    ctx.globalAlpha = 1;

    // Selected marker gets a full-height wick so it is findable at a glance.
    if (shots[selectedIndex]) {
      const x = Math.round(xOf(shots[selectedIndex].timestamp_s)) + 0.5;
      ctx.strokeStyle = token("--color-ink");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, TRACK_TOP - 6);
      ctx.lineTo(x, TRACK_TOP + TRACK_HEIGHT + 4);
      ctx.stroke();
    }

    // Playhead, in brand orange — a fill, which is what the brand colour is for.
    const playheadX = Math.round(xOf(time)) + 0.5;
    ctx.strokeStyle = token("--color-brand");
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, CANVAS_HEIGHT);
    ctx.stroke();
  }, [shots, rallies, width, time, selectedIndex, visible, xOf]);

  const hovered = hover !== null ? shots[hover] : null;

  const handlePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHover(hitTest(event.clientX - rect.left));
  };

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const hit = hitTest(event.clientX - rect.left);
    if (hit !== null) onSelect(hit);
  };

  // Ticks are labelled on whichever clock the track is laid out on, so a label
  // always sits where that time actually is.
  const ticks = useMemo(() => {
    const step =
      trackDuration > 900
        ? 300
        : trackDuration > 300
          ? 120
          : trackDuration > 60
            ? 30
            : 5;
    const out: number[] = [];
    for (let t = 0; t <= trackDuration; t += step) out.push(t);
    return out;
  }, [trackDuration]);

  return (
    <div className="rounded-card border-border bg-surface border p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Shot timeline</h2>
        <span data-numeric className="text-ink-muted font-mono text-xs">
          {shots.length} shots · {rallies.length} rallies
        </span>
      </div>

      <div ref={wrapRef} className="relative">
        <canvas
          ref={canvasRef}
          style={{ height: CANVAS_HEIGHT }}
          className="w-full cursor-pointer"
          onPointerMove={handlePointer}
          onPointerLeave={() => setHover(null)}
          onClick={handleClick}
          role="presentation"
        />

        {hovered && hover !== null && (
          <div
            className="border-border bg-surface pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded border px-2 py-1 text-xs whitespace-nowrap"
            style={{ left: xOf(hovered.timestamp_s) }}
          >
            <span className="font-semibold">
              {SHOT_CLASS_META[hovered.shot_class].letter}
            </span>{" "}
            {SHOT_CLASS_META[hovered.shot_class].label} · {hovered.player} ·{" "}
            <span data-numeric className="font-mono">
              {(hovered.class_confidence * 100).toFixed(0)}%
            </span>
            <span className="text-ink-muted">
              {" "}
              · rally {hovered.rally_id + 1}, shot {hovered.shot_index + 1}
            </span>
            {hovered.abstain && (
              <span className="text-ink-muted"> · uncertain</span>
            )}
          </div>
        )}
      </div>

      <div
        data-numeric
        className="text-ink-subtle mt-1 flex justify-between font-mono text-xs"
      >
        {ticks.map((t) => (
          <span key={t}>{formatClock(t)}</span>
        ))}
      </div>

      <p className="text-ink-muted mt-2 text-xs">
        Left player above the line, right below. Shorter hatched markers are
        shots PongAI is not confident enough to label.
      </p>
    </div>
  );
}
