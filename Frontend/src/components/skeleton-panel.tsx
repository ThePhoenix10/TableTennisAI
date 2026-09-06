"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { readKeypoint, wristSpeedSeries } from "@/lib/analysis";
import type { CropTrack } from "@/lib/real-demo";
import {
  CONTACT_INDEX,
  GRID_FPS,
  KEYPOINT_INDEX,
  SHOT_CLASS_META,
  SKELETON_EDGES,
  WINDOW_FRAMES,
} from "@/lib/constants";
import type { Player, Shot } from "@/lib/types";
import { CropView } from "./crop-view";

const TRAIL_FRAMES = 120; // ~1s of wrist history on the 120fps pose grid.

interface Props {
  player: Player;
  label: string;
  shot: Shot | null;
  shotIndex: number | null;
  poses: Float32Array | null;
  /** Playback time relative to the active shot's contact, in seconds. */
  offsetS: number;
  shotCount: number;
  active: boolean;
  /** Crop centres for the video view. Null = no footage for this match. */
  track?: CropTrack | null;
  video?: HTMLVideoElement | null;
  /** Playback position, in seconds, for the crop. */
  currentTime?: number;
  /** True once the video element can be drawn from. */
  videoReady?: boolean;
}

/**
 * A per-player panel, in one of two views:
 *
 *  - **Video** — a zoomed crop of that player from the match footage. The
 *    pipeline draws the skeleton into the video itself, so a coach sees the
 *    actual body: posture, grip, weight, footwork.
 *  - **Skeleton** — the isolated canonical figure, hip-centred and
 *    torso-scaled, so form can be compared between shots regardless of court
 *    position.
 *
 * Which are available depends on the match: real exports ship footage and a
 * crop track but no pose windows; synthetic ones are the reverse. When only
 * one exists the toggle is hidden.
 */
export function SkeletonPanel({
  player,
  label,
  shot,
  shotIndex,
  poses,
  offsetS,
  shotCount,
  active,
  track = null,
  video = null,
  currentTime = 0,
  videoReady = false,
}: Props) {
  const canCrop = track !== null && video !== null;
  const canSkeleton = poses !== null;

  // Preference, not the resolved view: `canCrop` flips from false to true when
  // the track arrives, so resolving at render (rather than seeding state once)
  // is what makes the panel switch to video after load.
  const [preferred, setPreferred] = useState<"video" | "skeleton">("video");
  const showVideo = canCrop && (preferred === "video" || !canSkeleton);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparkRef = useRef<HTMLCanvasElement>(null);

  // Which frame of the 97-frame window playback is sitting on.
  const frame = useMemo(() => {
    const f = Math.round(CONTACT_INDEX + offsetS * GRID_FPS);
    return Math.min(WINDOW_FRAMES - 1, Math.max(0, f));
  }, [offsetS]);

  const speeds = useMemo(
    () =>
      poses && shotIndex !== null ? wristSpeedSeries(poses, shotIndex) : null,
    [poses, shotIndex],
  );

  /* ------------------------------------------------------------ skeleton -- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();

    if (!poses || shotIndex === null || !active) {
      // Between rallies, dim rather than freezing on a stale pose (§7).
      // "Not available" and "between rallies" are different claims: a match
      // with no pose windows never gets them, and must not read as loading.
      ctx.fillStyle = token("--color-ink-subtle");
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        poses ? "between rallies" : "no pose data for this match",
        w / 2,
        h / 2,
      );
      return;
    }

    // Map torso-length coords into the canvas. y runs downward already.
    const scale = h / 3.6;
    const cx = w / 2;
    const cy = h * 0.62;
    const project = (k: number, f = frame): [number, number] => {
      const [x, y] = readKeypoint(poses, shotIndex, f, k);
      return [cx + x * scale, cy + y * scale];
    };

    // Wrist trail — a fading trace over the last ~1s, so the swing path is
    // visible, which a static skeleton cannot show.
    const wrists = [KEYPOINT_INDEX.LEFT_WRIST, KEYPOINT_INDEX.RIGHT_WRIST];
    ctx.lineWidth = 2;
    for (const wrist of wrists) {
      const from = Math.max(0, frame - TRAIL_FRAMES);
      for (let f = from + 1; f <= frame; f += 1) {
        const age = (frame - f) / TRAIL_FRAMES;
        ctx.globalAlpha = (1 - age) * 0.5;
        ctx.strokeStyle = token("--color-brand");
        ctx.beginPath();
        const [x1, y1] = project(wrist, f - 1);
        const [x2, y2] = project(wrist, f);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Bones.
    ctx.strokeStyle = token("--color-ink");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const [a, b] of SKELETON_EDGES) {
      const [x1, y1] = project(a);
      const [x2, y2] = project(b);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Joints. Wrists drawn larger — they carry most of the signal.
    for (let k = 0; k < 17; k += 1) {
      const [x, y] = project(k);
      const isWrist =
        k === KEYPOINT_INDEX.LEFT_WRIST || k === KEYPOINT_INDEX.RIGHT_WRIST;
      ctx.fillStyle = isWrist ? token("--color-brand") : token("--color-ink");
      ctx.beginPath();
      ctx.arc(x, y, isWrist ? 5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [poses, shotIndex, frame, active]);

  /* ---------------------------------------------------------- sparkline -- */
  useEffect(() => {
    const canvas = sparkRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!speeds || !active) return;

    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();

    const peak = Math.max(...speeds, 1e-6);
    ctx.strokeStyle = token("--color-ink-muted");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    speeds.forEach((v, i) => {
      const x = (i / (WINDOW_FRAMES - 1)) * w;
      const y = h - (v / peak) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Contact marker — this is the moment the detector keys on.
    const contactX = (CONTACT_INDEX / (WINDOW_FRAMES - 1)) * w;
    ctx.strokeStyle = token("--color-brand");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(contactX, 0);
    ctx.lineTo(contactX, h);
    ctx.stroke();

    // Where playback currently sits.
    const playX = (frame / (WINDOW_FRAMES - 1)) * w;
    ctx.fillStyle = token("--color-ink");
    ctx.beginPath();
    ctx.arc(
      playX,
      h - (speeds[frame] / peak) * (h - 4) - 2,
      2.5,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }, [speeds, frame, active]);

  const meta = shot ? SHOT_CLASS_META[shot.shot_class] : null;

  return (
    <section
      aria-label={`${label} player skeleton`}
      className={[
        "rounded-card border-border bg-surface flex flex-col border p-4 transition-opacity duration-150 ease-out",
        active ? "opacity-100" : "opacity-55",
      ].join(" ")}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span data-numeric className="text-ink-muted font-mono text-xs">
          {shotCount} shots
        </span>
      </header>

      {/* Video for context, isolated skeleton for comparing form across shots.
          Only offered when the match actually has both. */}
      {canCrop && canSkeleton && (
        <div role="group" aria-label="View" className="mt-2 flex gap-1">
          {(["video", "skeleton"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setPreferred(v)}
              aria-pressed={showVideo === (v === "video")}
              className={[
                "rounded border px-2 py-0.5 text-xs transition-colors duration-150 ease-out",
                showVideo === (v === "video")
                  ? "border-brand bg-brand text-on-brand"
                  : "border-border text-ink-muted",
              ].join(" ")}
            >
              {v === "video" ? "Video" : "Skeleton"}
            </button>
          ))}
        </div>
      )}

      {showVideo ? (
        // The crop is 2:3 portrait in the export, so the panel matches it
        // rather than stretching the player.
        <>
          <CropView
            video={video}
            track={track}
            side={player}
            currentTime={currentTime}
            ready={videoReady}
            // The export crops 600×900, so the canvas must be 2:3 or the
            // player is stretched. Width is capped rather than height: a
            // max-height would win over the aspect ratio at any panel wider
            // than 192px — which is every panel — and smear the figure.
            className="border-border bg-bg mx-auto mt-3 aspect-2/3 w-full max-w-48 rounded border"
          />
          {/* The crop follows the detector, and the detector does not hold this
              player for most of the clip. Saying so beats an unexplained view
              of empty court. */}
          <p className="text-ink-subtle mt-1 text-xs">
            Tracked in{" "}
            <span data-numeric className="font-mono">
              {Math.round(track.header.players[player].detected_pct * 100)}%
            </span>{" "}
            of frames; elsewhere the crop rests on this half of the table.
          </p>
        </>
      ) : (
        <canvas
          ref={canvasRef}
          className="mt-3 h-56 w-full"
          role="img"
          aria-label={
            shot
              ? `Pose for a ${meta?.label} by the ${player} player`
              : "No shot in progress"
          }
        />
      )}

      {/* Current-shot chip. Blank between shots. */}
      <div className="mt-2 min-h-7">
        {shot && meta && (
          <span
            className={[
              "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs",
              shot.abstain
                ? "border-border text-ink-muted hatch-uncertain"
                : "border-border",
            ].join(" ")}
          >
            <span
              aria-hidden
              className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: meta.colorVar }}
            >
              {meta.letter}
            </span>
            {meta.label}
            {/* No confidence figure here: "0.91" is ML plumbing, not coaching,
                and it invites judging individual shots. Confidence lives at the
                finding level instead (revision 2 §5). */}
            {shot.abstain && <span className="text-ink-muted">uncertain</span>}
          </span>
        )}
      </div>

      {/* The sparkline is derived from pose windows, so it is omitted rather
          than shown empty for matches that ship none. */}
      {canSkeleton && (
        <div className="mt-3">
          <p className="text-ink-muted text-xs">Wrist speed</p>
          <canvas
            ref={sparkRef}
            className="mt-1 h-10 w-full"
            role="presentation"
          />
          <p className="text-ink-subtle mt-1 text-xs">
            The signal the detector reads. Orange line is contact.
          </p>
        </div>
      )}
    </section>
  );
}
