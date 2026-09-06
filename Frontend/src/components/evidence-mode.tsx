"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KINEMATIC_LABELS, formatClock } from "@/lib/analysis";
import { CONTACT_INDEX, GRID_FPS, WINDOW_FRAMES } from "@/lib/constants";
import type { Finding } from "@/lib/findings";
import type { Shot } from "@/lib/types";
import { PoseClip } from "./pose-clip";

/** The window played on each side: −48 to +36 frames around contact. */
const CLIP_START = CONTACT_INDEX - 48;
const CLIP_END = CONTACT_INDEX + 36;
const CLIP_FRAMES = CLIP_END - CLIP_START;

interface Props {
  finding: Finding;
  shots: Shot[];
  poses: Float32Array | null;
  onClose: () => void;
  /** Reports which shot the extreme clip is on, so the side panels can follow. */
  onExtremeShot: (index: number) => void;
}

/**
 * Evidence mode — revision 2 §4.
 *
 * A number persuades nobody; watching a shoulder drop in one clip and not the
 * other does it in five seconds.
 *
 * Both clips play frame −48 to +36 relative to **their own contact** and scrub
 * together. That alignment is the whole point — otherwise you are comparing
 * two moments that merely share a wall-clock offset.
 */
export function EvidenceMode({
  finding,
  shots,
  poses,
  onClose,
  onExtremeShot,
}: Props) {
  const pairs = useMemo(() => {
    const { extremeShots, typicalShots } = finding.evidence;
    const n = Math.min(extremeShots.length, typicalShots.length, 3);
    return Array.from({ length: n }, (_, i) => ({
      extreme: extremeShots[i],
      typical: typicalShots[i],
    }));
  }, [finding]);

  const [pair, setPair] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);

  // A new "show me" starts from the top. Resetting during render on a changed
  // key is React's own idiom for derived state, and avoids the extra render an
  // effect would cost.
  const [seenFinding, setSeenFinding] = useState(finding.id);
  if (seenFinding !== finding.id) {
    setSeenFinding(finding.id);
    setPair(0);
    setFrame(0);
    setPlaying(true);
  }

  const current = pairs[pair];
  const extremeShot = current?.extreme;

  useEffect(() => {
    if (extremeShot !== undefined) onExtremeShot(extremeShot);
  }, [extremeShot, onExtremeShot]);

  /* Looping playback on the shared clip clock. */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    let started = false;
    const tick = (now: number) => {
      if (started) {
        const delta = now - last;
        setFrame((f) => (f + (delta / 1000) * GRID_FPS) % CLIP_FRAMES);
      }
      last = now;
      started = true;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const step = useCallback(
    (delta: number) =>
      setPair((p) => (p + delta + pairs.length) % pairs.length),
    [pairs.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    // Capture, so this wins over the screen-level shot navigation while open.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, step]);

  if (!current) return null;

  const windowFrame = Math.min(
    WINDOW_FRAMES - 1,
    Math.max(0, Math.round(CLIP_START + frame)),
  );
  const { label, unit, dp } = KINEMATIC_LABELS[finding.metric];

  const side = (index: number, title: string, emphasis: boolean) => {
    const shot = shots[index];
    if (!shot) return null;
    const value = shot[finding.metric];
    return (
      <div className="min-w-0 flex-1">
        <p
          className={[
            "text-xs font-semibold tracking-wide uppercase",
            emphasis ? "text-brand-text" : "text-ink-muted",
          ].join(" ")}
        >
          {title}
        </p>
        <p data-numeric className="mt-0.5 font-mono text-sm">
          {typeof value === "number" ? value.toFixed(dp) : "—"}{" "}
          <span className="text-ink-muted">{unit}</span>
        </p>
        <div className="border-border bg-bg mt-2 overflow-hidden rounded border">
          <PoseClip
            poses={poses}
            shotIndex={index}
            frame={windowFrame}
            height={240}
          />
        </div>
        <p data-numeric className="text-ink-muted mt-1 font-mono text-xs">
          {formatClock(shot.timestamp_s)} · rally {shot.rally_id + 1} · shot{" "}
          {shot.shot_index + 1}
        </p>
      </div>
    );
  };

  return (
    <section
      aria-label="Evidence"
      className="rounded-card border-border bg-surface flex flex-col border p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">{finding.headline}</h2>
        <button
          type="button"
          onClick={onClose}
          className="border-border text-ink-muted shrink-0 rounded border px-2 py-1 text-xs"
        >
          × close
        </button>
      </header>

      <div className="mt-3 flex gap-4">
        {side(current.extreme, "Most extreme", true)}
        {side(current.typical, "Most typical", false)}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous pair"
            className="border-border rounded border px-2 py-1 text-sm"
          >
            ◀
          </button>
          <span data-numeric className="font-mono text-xs">
            pair {pair + 1} / {pairs.length}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next pair"
            className="border-border rounded border px-2 py-1 text-sm"
          >
            ▶
          </button>
        </div>

        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="bg-brand text-on-brand rounded px-3 py-1 text-sm font-medium"
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>

      <label className="mt-2 flex items-center gap-2">
        <span className="sr-only">Scrub both clips</span>
        <input
          type="range"
          min={0}
          max={CLIP_FRAMES - 1}
          step={1}
          value={Math.round(frame)}
          onChange={(e) => {
            setPlaying(false);
            setFrame(Number(e.target.value));
          }}
          className="accent-brand w-full"
        />
      </label>

      <p className="text-ink-subtle mt-1 text-xs">
        Both clips are aligned on their own contact frame and scrub together.
        ←/→ pair · Space play/pause · Esc close.
      </p>

      <p className="text-ink-muted mt-2 text-xs">
        Comparing {label.toLowerCase()} across {finding.evidence.sampleSize}{" "}
        {finding.shotClass}s.
      </p>
    </section>
  );
}
