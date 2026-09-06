"use client";

import { formatClock } from "@/lib/analysis";
import type { Rally } from "@/lib/analysis";
import { SHOT_CLASS_META } from "@/lib/constants";
import { VIDEO_USE_CORS } from "@/lib/real-demo";
import {
  segmentAt,
  segmentsDuration,
  toCompressed,
  toSource,
  type Segment,
} from "@/lib/rally-segments";
import type { AnalysisFile, Shot } from "@/lib/types";
import type { Playback } from "@/lib/use-playback";

interface Props {
  file: AnalysisFile;
  playback: Playback;
  rally: Rally | null;
  rallyCount: number;
  selected: Shot | null;
  /** Owned by the screen, because the player panels crop from this element. */
  videoRef: React.Ref<HTMLVideoElement>;
  onVideoReady: () => void;
  onVideoError: (message: string) => void;
  /** Playable rally spans; empty when the match has none. */
  segments: Segment[];
  ralliesOnly: boolean;
  onRalliesOnlyChange: (next: boolean) => void;
}

/**
 * The video surface and transport.
 *
 * Real matches mount a `<video>`, which also becomes the source the two player
 * panels crop from — one decode, one playhead. Synthetic matches have no
 * footage and fall back to a placeholder with the synthetic clock behind it;
 * that path is still supported and must not be removed.
 */
export function VideoStage({
  file,
  playback,
  rally,
  rallyCount,
  selected,
  videoRef,
  onVideoReady,
  onVideoError,
  segments,
  ralliesOnly,
  onRalliesOnlyChange,
}: Props) {
  const { time, duration, playing, toggle, seek } = playback;
  const meta = selected ? SHOT_CLASS_META[selected.shot_class] : null;

  // With the gaps removed, the transport measures progress through the rallies
  // rather than through the file — otherwise the scrubber would spend most of
  // its travel on footage that is being skipped.
  const compressing = ralliesOnly && segments.length > 0;
  const trackDuration = compressing ? segmentsDuration(segments) : duration;
  const trackPosition = compressing ? toCompressed(segments, time) : time;
  const seekFromTrack = (value: number) =>
    seek(compressing ? toSource(segments, value) : value);

  // A padded span starts before its first contact, so rallies-only playback
  // spends a second or two inside a rally that has not begun. Reporting that
  // as "between rallies" makes the toggle look like it did nothing.
  const upcoming =
    compressing && !rally ? segmentAt(segments, time)?.rallyId : undefined;

  return (
    <section
      aria-label="Video"
      className="rounded-card border-border bg-surface flex flex-col border p-4"
    >
      <div className="bg-bg border-border relative aspect-video w-full overflow-hidden rounded border">
        {file.video_url ? (
          <video
            ref={videoRef}
            src={file.video_url}
            // NOT crossOrigin="anonymous": the R2 bucket sends no CORS header,
            // and requesting credentials-less CORS makes the browser reject the
            // file outright. See VIDEO_USE_CORS in lib/real-demo.ts.
            {...(VIDEO_USE_CORS ? { crossOrigin: "anonymous" as const } : {})}
            className="size-full object-contain"
            playsInline
            preload="metadata"
            muted
            onLoadedData={onVideoReady}
            onCanPlay={onVideoReady}
            onError={() =>
              onVideoError(
                "The match video could not be loaded. Analytics below are unaffected.",
              )
            }
          />
        ) : (
          <div className="text-ink-subtle flex size-full flex-col items-center justify-center gap-1 p-4 text-center">
            <p className="text-sm">No footage for this demo</p>
            <p className="text-xs">
              Playback runs on a synthetic clock. Skeletons and analytics are
              live.
            </p>
          </div>
        )}

        {/* Rally position, top-left — the wireframe's RALLY n / N. */}
        <div className="bg-surface/90 border-border absolute top-2 left-2 rounded border px-2 py-1 text-xs">
          {rally ? (
            <>
              <span data-numeric className="font-mono font-semibold">
                Rally {rally.id + 1} / {rallyCount}
              </span>
              {selected && selected.rally_id === rally.id && (
                <span data-numeric className="text-ink-muted font-mono">
                  {" "}
                  · shot {selected.shot_index + 1} of {rally.length}
                </span>
              )}
            </>
          ) : upcoming !== undefined ? (
            <>
              <span data-numeric className="font-mono font-semibold">
                Rally {upcoming + 1} / {rallyCount}
              </span>
              <span className="text-ink-muted"> · starting</span>
            </>
          ) : (
            <span className="text-ink-muted">Between rallies</span>
          )}
        </div>

        {selected && meta && (
          <div className="bg-surface/90 border-border absolute top-2 right-2 flex items-center gap-1.5 rounded border px-2 py-1 text-xs">
            <span
              aria-hidden
              className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: meta.colorVar }}
            >
              {meta.letter}
            </span>
            {meta.label}
            {selected.abstain && (
              <span className="text-ink-muted">uncertain</span>
            )}
          </div>
        )}
      </div>

      {/* Transport */}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="bg-brand text-on-brand hover:bg-brand-hover rounded px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-out"
        >
          {playing ? "Pause" : "Play"}
        </button>

        <label className="flex flex-1 items-center gap-2">
          <span className="sr-only">Seek</span>
          <input
            type="range"
            min={0}
            max={trackDuration}
            step={0.05}
            value={trackPosition}
            onChange={(e) => seekFromTrack(Number(e.target.value))}
            className="accent-brand w-full"
          />
        </label>

        <span data-numeric className="text-ink-muted font-mono text-xs">
          {formatClock(trackPosition)} / {formatClock(trackDuration)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink-subtle text-xs">
          ←/→ shot · Shift+←/→ rally · Space play/pause
        </p>

        {segments.length > 0 && (
          <button
            type="button"
            role="switch"
            aria-checked={ralliesOnly}
            onClick={() => onRalliesOnlyChange(!ralliesOnly)}
            className={[
              "flex shrink-0 items-center gap-2 rounded border px-2 py-1.5 text-xs leading-none transition-colors duration-150 ease-out",
              ralliesOnly
                ? "border-brand bg-brand text-on-brand"
                : "border-border text-ink-muted",
            ].join(" ")}
          >
            {/* A track-and-knob shape, so the state reads without colour.
                The knob is centred by the track's own flex + padding rather
                than by absolute offsets, so its inset is symmetric at both
                ends by construction. */}
            <span
              aria-hidden
              className={[
                "flex h-4 w-7 shrink-0 items-center rounded-full border p-0.5 transition-colors duration-150 ease-out",
                ralliesOnly
                  ? "border-on-brand/40 bg-on-brand/25"
                  : "border-border bg-bg",
              ].join(" ")}
            >
              <span
                className={[
                  "size-2.5 rounded-full transition-transform duration-150 ease-out",
                  ralliesOnly
                    ? "bg-on-brand translate-x-3"
                    : "bg-ink-muted translate-x-0",
                ].join(" ")}
              />
            </span>
            Show only rallies
          </button>
        )}
      </div>

      {ralliesOnly && segments.length > 0 && (
        <p className="text-ink-subtle mt-1 text-xs">
          Skipping the gaps between points —{" "}
          <span data-numeric className="font-mono">
            {formatClock(trackDuration)}
          </span>{" "}
          of play from{" "}
          <span data-numeric className="font-mono">
            {formatClock(duration)}
          </span>{" "}
          of video. Times and the timeline follow the rallies.
        </p>
      )}
    </section>
  );
}
