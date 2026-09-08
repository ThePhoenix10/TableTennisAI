import type { AnalysisFile } from "./types";

/**
 * Loading for REAL exported matches — revision 3 (`PONGAI_WIRE_REAL_DEMO.md`).
 *
 * Real exports live in a per-match subfolder (`/demo/game_1/game_1.json`),
 * unlike the flat synthetic fixtures (`/demo/game_2.json`).
 *
 * Three things in the real export do not match its own documentation, all
 * verified against the shipped file — see the notes on each workaround below.
 */

/**
 * The match video, hosted on Cloudflare R2.
 *
 * NOT taken from the export's own `video_url`, which reads `/demo/game_1.mp4`
 * — a local path with no file behind it (the mp4 is deliberately never
 * committed). This constant is the URL that actually serves the footage.
 */
export const R2_VIDEO_URL =
  "https://pub-366667bd9f864bb384d0bf31bf95da26.r2.dev/game_1_web.mp4";

/**
 * Whether to set `crossOrigin="anonymous"` on the video element.
 *
 * The task document requires it, on the grounds that without it `drawImage`
 * taints the canvas and the player panels render blank. Measured against the
 * live bucket, both halves of that are wrong:
 *
 *   - The bucket sends NO `Access-Control-Allow-Origin` header, so with
 *     `crossOrigin="anonymous"` the browser refuses the file outright:
 *     `MEDIA_ELEMENT_ERROR: Format error`, readyState 0. Nothing plays at all.
 *   - Tainting does not blank a canvas. A tainted canvas still draws and
 *     displays; it only refuses pixel *readback* (`getImageData`,
 *     `toDataURL`), which the panels never do.
 *
 * So it is left off, and the crops work. If CORS is later configured on the
 * bucket, flip this to true — that is strictly better, since it also restores
 * readback — but verify the video still loads before shipping the change.
 */
export const VIDEO_USE_CORS = false;

/**
 * Parses a real export.
 *
 * The exporter writes bare `NaN` literals for missing values (2 of them in
 * `game_1.json`, both `recovery_time`). `NaN` is not valid JSON, so
 * `response.json()` throws `SyntaxError: Unexpected token 'N'` and the match
 * never loads. The text is repaired to `null` first, which is both valid JSON
 * and what our `Shot` type already declares for absent numerics.
 */
export function parseExportJson(text: string): AnalysisFile {
  const repaired = text
    .replace(/\bNaN\b/g, "null")
    .replace(/\b-?Infinity\b/g, "null");
  return JSON.parse(repaired) as AnalysisFile;
}

/** Header for the crop track that accompanies a real export. */
export interface TrackHeader {
  fps: number;
  n_frames: number;
  video_w: number;
  video_h: number;
  /** Divide stored int16 values by this. */
  scale: number;
  layout: string[];
  dtype: string;
  /** Values per frame. */
  stride: number;
  players: Record<
    "left" | "right",
    { crop_w: number; crop_h: number; detected_pct: number }
  >;
}

export interface CropTrack {
  header: TrackHeader;
  /** Raw int16 view over the whole file — a view, never a parse. */
  data: Int16Array;
}

/**
 * Loads the crop track for a real match.
 *
 * The export's own `track_url` points at `/demo/game_1.track.json`, one folder
 * above where the file actually sits, so paths are built from the match id
 * instead.
 */
export async function loadCropTrack(id: string): Promise<CropTrack | null> {
  const base = `/demo/${id}/${id}`;
  return loadCropTrackFrom(`${base}.track.json`, `${base}.track.bin`, id);
}

/**
 * Fetch and validate a crop track from explicit URLs.
 *
 * Demos build their URLs from the folder convention; live analyses receive
 * signed blob URLs from the API. The parsing and the length check are the
 * same either way, so they live here rather than in both callers.
 */
export async function loadCropTrackFrom(
  headerUrl: string,
  binUrl: string,
  label: string,
): Promise<CropTrack | null> {
  const [headerRes, binRes] = await Promise.all([
    fetch(headerUrl),
    fetch(binUrl),
  ]);
  if (!headerRes.ok || !binRes.ok) return null;

  const header = (await headerRes.json()) as TrackHeader;
  const data = new Int16Array(await binRes.arrayBuffer());

  // A truncated track would silently produce garbage crops, so check the size
  // the header implies before trusting it.
  const expected = header.n_frames * header.stride;
  if (data.length < expected) {
    console.warn(
      `Crop track for ${label} is short: ${data.length} of ${expected} int16 values`,
    );
  }
  return { header, data };
}

export interface CropRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/**
 * Crop rectangle for one player at a given video time, in video pixels.
 *
 * The centres are already smoothed and clamped by the exporter, so they are
 * used verbatim — smoothing again would only add lag.
 */
export function cropRectAt(
  track: CropTrack,
  side: "left" | "right",
  currentTime: number,
): CropRect | null {
  const { header, data } = track;
  const frame = Math.min(
    Math.max(Math.round(currentTime * header.fps), 0),
    header.n_frames - 1,
  );
  const offset = frame * header.stride + (side === "left" ? 0 : 2);
  if (offset + 1 >= data.length) return null;

  const player = header.players[side];
  return {
    cx: data[offset] / header.scale,
    cy: data[offset + 1] / header.scale,
    w: player.crop_w,
    h: player.crop_h,
  };
}
