"use client";

import { useEffect, useRef, useState } from "react";
import { cropRectAt, type CropTrack } from "@/lib/real-demo";

/**
 * A zoomed crop of one player, taken from the shared match video.
 *
 * The pipeline draws the skeleton INTO the exported video, so nothing is
 * overlaid here — this only copies a rectangle of the same frame. One `<video>`
 * decodes for the whole screen; each panel is a canvas cropping from it, so
 * there is a single decode and a single playhead.
 *
 * Both canvases are driven by one shared rAF loop owned by the parent, which
 * passes the frame down as `currentTime`.
 */
export function CropView({
  video,
  track,
  side,
  currentTime,
  ready,
  className,
}: {
  video: HTMLVideoElement | null;
  track: CropTrack | null;
  side: "left" | "right";
  currentTime: number;
  /** The parent's readyState gate; drawing early paints black. */
  ready: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Last time drawn, so a paused video is not redrawn every frame. */
  const drawnAtRef = useRef<number | null>(null);
  const drawnRevisionRef = useRef(-1);
  /** Bumped whenever the frame may have changed without `currentTime` doing so. */
  const [revision, setRevision] = useState(0);

  /**
   * A seek settles AFTER the optimistic `time` update that requested it, so the
   * pixels on screen can be stale while `currentTime` already equals what was
   * last drawn. Without this, skip-when-unchanged would suppress the corrective
   * redraw and the crop would keep showing the pre-seek frame.
   *
   * ResizeObserver is here for the same reason: the backing store is sized from
   * the CSS box, so a paused canvas would otherwise stay at the old resolution.
   */
  useEffect(() => {
    if (!video) return;
    const bump = () => setRevision((n) => n + 1);
    video.addEventListener("seeked", bump);
    video.addEventListener("loadeddata", bump);
    return () => {
      video.removeEventListener("seeked", bump);
      video.removeEventListener("loadeddata", bump);
    };
  }, [video]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setRevision((n) => n + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  /**
   * Draw the very first frame.
   *
   * `loadeddata` fires before the element has a frame the compositor will hand
   * to `drawImage`: the call succeeds and paints nothing. With the video paused
   * at 0 nothing else ever changes — no `seeked`, no time advance — so both
   * panels sat blank until the user seeked or pressed play.
   *
   * `requestVideoFrameCallback` fires once a frame is actually presented. It is
   * requested once, not looped: continuous redrawing is the parent's job.
   */
  useEffect(() => {
    if (!video || !ready) return;
    let cancelled = false;
    const bump = () => {
      if (!cancelled) setRevision((n) => n + 1);
    };

    const withCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    if (typeof withCallback.requestVideoFrameCallback === "function") {
      const handle = withCallback.requestVideoFrameCallback(bump);
      return () => {
        cancelled = true;
        withCallback.cancelVideoFrameCallback?.(handle);
      };
    }

    // Safari before 15.4 and older Firefox: retry shortly instead.
    const timer = setTimeout(bump, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [video, ready]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !track || !video) return;

    // Drawing from an unloaded or seeking element paints black or throws.
    if (!ready || video.readyState < 2) return;

    // Skip only when neither the time nor the underlying frame has changed.
    if (
      drawnAtRef.current === currentTime &&
      drawnRevisionRef.current === revision
    ) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const rect = cropRectAt(track, side, currentTime);
    if (!rect) return;

    // Centres are already smoothed and clamped by the exporter, and are already
    // in the video's pixel space — do not smooth or rescale them again.
    const sx = rect.cx - rect.w / 2;
    const sy = rect.cy - rect.h / 2;

    try {
      // A cross-origin video taints the canvas, which is harmless: a tainted
      // canvas still draws and displays, it only refuses pixel readback.
      ctx.drawImage(video, sx, sy, rect.w, rect.h, 0, 0, w, h);
      drawnAtRef.current = currentTime;
      drawnRevisionRef.current = revision;
    } catch {
      // A frame that is not decodable yet — leave the previous one on screen
      // rather than clearing to black.
    }
  }, [video, track, side, currentTime, ready, revision]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={`Cropped view of the ${side} player`}
    />
  );
}
