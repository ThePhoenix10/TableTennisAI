/**
 * The browser half of `pongai/core/validation.py`.
 *
 * Two rules this file follows, both from the backend's own design:
 *
 *  1. Every threshold comes from GET /api/limits. Nothing here is hardcoded,
 *     so the browser cannot start accepting what the worker rejects.
 *  2. It returns ALL problems at once. Someone with a long vertical 24fps clip
 *     should see three issues in one go, not fix one and resubmit twice.
 */
import type { Limits, Rejection } from "./api-types";
import type { ProbeResult } from "./probe";

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

export function validateAgainstLimits(
  file: File,
  p: ProbeResult,
  L: Limits,
): Rejection[] {
  const out: Rejection[] = [];
  const aspect = p.width / Math.max(p.height, 1);

  if (file.size > L.max_size_bytes) {
    out.push({
      code: "file_too_large",
      severity: "reject",
      message: `This file is ${mb(file.size)}. The limit is ${mb(L.max_size_bytes)}.`,
      detail: "Trim the clip or export at a lower bitrate.",
    });
  }

  if (p.duration_s > L.max_duration_s) {
    out.push({
      code: "too_long",
      severity: "reject",
      message: `This clip is ${(p.duration_s / 60).toFixed(1)} minutes. The limit is ${Math.round(L.max_duration_s / 60)} minutes.`,
      detail: "Analysis runs at about 5x realtime.",
    });
  } else if (p.duration_s > 0 && p.duration_s < L.min_duration_s) {
    out.push({
      code: "too_short",
      severity: "reject",
      message: `This clip is ${p.duration_s.toFixed(1)} seconds. At least ${L.min_duration_s} seconds are needed.`,
    });
  }

  if (p.width < L.min_width || p.height < L.min_height) {
    out.push({
      code: "resolution_too_low",
      severity: "reject",
      message: `This video is ${p.width}x${p.height}. At least ${L.min_width}x${L.min_height} is needed.`,
      detail: "Body joints cannot be located reliably at lower resolutions.",
    });
  }

  if (p.width > 0 && aspect < L.min_aspect) {
    out.push({
      code: "aspect_vertical",
      severity: "reject",
      message:
        "This looks like a vertical video. PongAI needs a landscape recording.",
      detail:
        "A side-on view has to fit the whole table in frame, which a vertical crop cannot do.",
    });
  }

  // Frame rate is only checked when it could actually be measured. Guessing it
  // would risk blocking a good file on a browser that cannot report it.
  if (p.fps != null) {
    if (p.fps < L.min_fps) {
      out.push({
        code: "fps_too_low",
        severity: "reject",
        message: `This video is ${Math.round(p.fps)}fps. PongAI needs at least ${L.min_fps}fps.`,
        detail: `A stroke's acceleration phase lasts about 120ms, which is barely three frames at ${L.min_fps}fps. Below that it is sampled too sparsely to detect the stroke reliably.`,
      });
    } else if (p.fps > L.max_fps) {
      out.push({
        code: "fps_too_high",
        severity: "reject",
        message: `This video is ${Math.round(p.fps)}fps, above the ${L.max_fps}fps limit.`,
      });
    } else if (p.fps < L.velocity_min_fps) {
      // Not a rejection. It uploads and analyses; only swing speed is withheld.
      out.push({
        code: "velocity_unavailable",
        severity: "warn",
        message: `At ${Math.round(p.fps)}fps, swing-speed metrics will be withheld.`,
        detail:
          "Shot detection, rally structure and stroke types are unaffected. The wrist-speed peak is only about 33ms wide, so at 30fps it is under-measured by roughly half.",
      });
    }
  }

  return out;
}

export const blocking = (r: Rejection[]) =>
  r.filter((x) => x.severity === "reject");
export const warnings = (r: Rejection[]) =>
  r.filter((x) => x.severity === "warn");
export const isAcceptable = (r: Rejection[]) => blocking(r).length === 0;
