import { readFile } from "node:fs/promises";
import path from "node:path";
import { isSyntheticDemo } from "./constants";
import { parseExportJson } from "./real-demo";

/**
 * Match figures read from the analysis JSON at build time — SERVER ONLY.
 *
 * The demo registry deliberately holds no counts or durations: duplicating them
 * lets a card contradict the screen it links to. The home page is a server
 * component, so it reads the real numbers off disk instead of hardcoding them.
 */
export interface DemoStats {
  durationS: number;
  shots: number;
  rallies: number;
  fps: number;
}

export async function readDemoStats(id: string): Promise<DemoStats | null> {
  // Real exports are nested per match; synthetic fixtures are flat.
  const relative = isSyntheticDemo(id)
    ? `${id}.json`
    : path.join(id, `${id}.json`);
  const file = path.join(process.cwd(), "public", "demo", relative);

  try {
    // Via `parseExportJson`, since real exports contain bare `NaN`.
    const analysis = parseExportJson(await readFile(file, "utf8"));
    return {
      durationS: analysis.duration_s,
      shots: analysis.shots.length,
      rallies: new Set(analysis.shots.map((s) => s.rally_id)).size,
      fps: Math.round(analysis.source_fps),
    };
  } catch {
    // A synthetic fixture that has not been generated yet, or a malformed
    // export: the card renders without figures rather than failing the build.
    return null;
  }
}
