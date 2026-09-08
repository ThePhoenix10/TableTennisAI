/**
 * Loading for analyses produced by the API, as opposed to the bundled demos.
 *
 * The two differ only in where the bytes come from. A demo is static JSON in
 * `public/demo/`; a live analysis is `GET /api/analyses/{job_id}` plus signed
 * blob URLs. Both end up as the same `AnalysisFile`, so every screen below
 * this point is identical — which is the point. A second rendering path for
 * real matches is how the two quietly stop agreeing.
 */
import { getAnalysis } from "./api";
import type { Analysis as ApiAnalysis } from "./api-types";
import { loadCropTrackFrom, type CropTrack } from "./real-demo";
import type { AnalysisFile } from "./types";

export interface LiveAnalysis {
  file: AnalysisFile;
  trackJsonUrl: string;
  trackBinUrl: string;
  thumbUrl: string | null;
}

/**
 * The API nests source properties under `meta`; `AnalysisFile` is flat.
 *
 * Nothing else is transformed. The shot records are the same contract on both
 * sides — `pongai/core/schema.py` defines them once for exactly this reason.
 */
export function toAnalysisFile(a: ApiAnalysis): AnalysisFile {
  return {
    video_id: a.meta.video_id,
    video_url: a.video_url,
    duration_s: a.meta.duration_s,
    source_fps: a.meta.source_fps,
    width: a.meta.width,
    height: a.meta.height,
    shots: a.shots,
  };
}

export async function loadLiveAnalysis(jobId: string): Promise<LiveAnalysis> {
  const a = await getAnalysis(jobId);
  return {
    file: toAnalysisFile(a),
    trackJsonUrl: a.track_url,
    trackBinUrl: a.track_bin_url,
    thumbUrl: a.thumb_url,
  };
}

export const loadLiveCropTrack = (
  jsonUrl: string,
  binUrl: string,
): Promise<CropTrack | null> => loadCropTrackFrom(jsonUrl, binUrl, "analysis");
