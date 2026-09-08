/**
 * Measure a video file in the browser, before uploading it.
 *
 * This is the first of the three call sites named in `pongai/core/validation.py`
 * — browser, API, worker. It exists purely for speed of feedback: catching a
 * vertical 24fps clip here costs a second, whereas catching it in the worker
 * costs an upload and a queue wait. The worker's ffprobe is authoritative and
 * re-checks everything.
 *
 * Duration and dimensions come straight off the element. Frame rate does not:
 * no browser API reports it. It has to be measured by counting presented
 * frames over a short muted play, which is why `fps` can come back null.
 */
import type { VideoProbe } from "./api-types";

export interface ProbeResult {
  duration_s: number;
  width: number;
  height: number;
  /** null when the frame rate could not be measured; see `measureFps`. */
  fps: number | null;
}

/** How long to sample playback for. Long enough to average out jitter. */
const SAMPLE_MS = 800;
const LOAD_TIMEOUT_MS = 15_000;

/**
 * How close to the display refresh rate counts as "the compositor capped us".
 *
 * `presentedFrames` counts frames the COMPOSITOR showed, which cannot exceed
 * the monitor's refresh rate. A 120fps video on a 60Hz screen measures ~59.4,
 * which is indistinguishable from a real 60fps file — and treating it as one
 * told the user their best possible footage would have swing speed withheld.
 */
const REFRESH_MARGIN = 0.9;

/** Measure the display refresh rate by timing animation frames. */
function measureRefreshHz(): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    let frames = 0;
    const tick = () => {
      frames++;
      const elapsed = performance.now() - start;
      if (elapsed >= 300) {
        resolve(frames / (elapsed / 1000));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

interface FrameMeta {
  mediaTime: number;
  presentedFrames: number;
}
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: FrameMeta) => void,
  ) => number;
};

/**
 * Frames presented divided by media time elapsed.
 *
 * `requestVideoFrameCallback` reports `presentedFrames` and `mediaTime` per
 * composited frame, so the ratio over a window is the source frame rate —
 * independent of how fast the machine happens to be decoding.
 *
 * Returns null where the API is missing (Firefox at time of writing) or
 * playback is blocked. A null probe is fine: the request simply carries no
 * client probe and the worker measures it properly.
 */
function measureFps(video: VideoWithFrameCallback): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback !== "function") {
      resolve(null);
      return;
    }
    let first: FrameMeta | null = null;
    let settled = false;
    const done = (fps: number | null) => {
      if (settled) return;
      settled = true;
      video.pause();
      resolve(fps);
    };

    const tick = (_now: number, meta: FrameMeta) => {
      if (!first) first = meta;
      const dt = meta.mediaTime - first.mediaTime;
      const frames = meta.presentedFrames - first.presentedFrames;
      if (dt >= SAMPLE_MS / 1000 && frames > 0) {
        const measured = frames / dt;
        // Pinned at the refresh rate means the source is at least this fast,
        // but we cannot tell how much faster. An upper bound is not a
        // measurement, so report nothing rather than something wrong.
        void measureRefreshHz().then((hz) =>
          done(measured >= hz * REFRESH_MARGIN ? null : measured),
        );
        return;
      }
      video.requestVideoFrameCallback?.(tick);
    };

    video.muted = true;
    video.requestVideoFrameCallback(tick);
    video.play().catch(() => done(null));
    // Autoplay refusal, a still first frame, or a codec the browser cannot
    // decode all end here rather than hanging the picker.
    window.setTimeout(() => done(null), SAMPLE_MS * 4);
  });
}

export async function probeVideoFile(file: File): Promise<ProbeResult> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video") as VideoWithFrameCallback;
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("The browser could not read this file.")),
        LOAD_TIMEOUT_MS,
      );
      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("This file could not be read as a video."));
      };
    });

    return {
      duration_s: Number.isFinite(video.duration) ? video.duration : 0,
      width: video.videoWidth,
      height: video.videoHeight,
      fps: await measureFps(video),
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Shape the measurement into the probe the API accepts, or null without fps. */
export function toApiProbe(file: File, p: ProbeResult): VideoProbe | null {
  if (!p.fps || !Number.isFinite(p.fps)) return null;
  return {
    size_bytes: file.size,
    duration_s: p.duration_s,
    width: p.width,
    height: p.height,
    fps: Math.round(p.fps * 100) / 100,
    n_frames: Math.round(p.duration_s * p.fps),
    source: "client",
  };
}
