"use client";

import { useEffect, useRef } from "react";
import { readKeypoint } from "@/lib/analysis";
import { KEYPOINT_INDEX, SKELETON_EDGES } from "@/lib/constants";

/**
 * A single skeleton frame on a canvas, in the canonical hip-centred,
 * torso-scaled space. Shared by evidence mode's two side-by-side clips.
 *
 * Deliberately dumb: it draws the frame it is given and owns no clock, so the
 * two clips in a comparison stay locked to one shared time source.
 */
export function PoseClip({
  poses,
  shotIndex,
  frame,
  height,
}: {
  poses: Float32Array | null;
  shotIndex: number;
  frame: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const styles = getComputedStyle(document.documentElement);
    const token = (n: string) => styles.getPropertyValue(n).trim();

    if (!poses) {
      // "Unavailable" and "loading" are different claims — a match that ships
      // no pose windows will never get them, and must not sit on a spinner.
      ctx.fillStyle = token("--color-ink-subtle");
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("no pose data for this match", w / 2, h / 2);
      return;
    }

    const scale = h / 3.6;
    const cx = w / 2;
    const cy = h * 0.62;
    const at = (k: number): [number, number] => {
      const [x, y] = readKeypoint(poses, shotIndex, frame, k);
      return [cx + x * scale, cy + y * scale];
    };

    ctx.strokeStyle = token("--color-ink");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const [a, b] of SKELETON_EDGES) {
      const [x1, y1] = at(a);
      const [x2, y2] = at(b);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    for (let k = 0; k < 17; k += 1) {
      const [x, y] = at(k);
      const wrist =
        k === KEYPOINT_INDEX.LEFT_WRIST || k === KEYPOINT_INDEX.RIGHT_WRIST;
      ctx.fillStyle = wrist ? token("--color-brand") : token("--color-ink");
      ctx.beginPath();
      ctx.arc(x, y, wrist ? 5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [poses, shotIndex, frame]);

  return (
    <canvas
      ref={ref}
      style={{ height }}
      className="w-full"
      role="img"
      aria-label="Skeleton frame"
    />
  );
}
