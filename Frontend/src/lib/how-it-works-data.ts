import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseExportJson } from "./real-demo";
import type { Shot } from "./types";

/**
 * Figures for the How it works page, read from the real match at build time —
 * SERVER ONLY.
 *
 * The page explains what the pipeline does, so the illustrations are the
 * pipeline's own output rather than drawings of it. Nothing here is invented;
 * if the export changes, the page changes with it.
 */
export interface RallySpan {
  start: number;
  end: number;
}

export interface HowItWorksData {
  durationS: number;
  fps: number;
  shots: Shot[];
  rallies: RallySpan[];
  /** Seconds of actual play, against the length of the recording. */
  activeS: number;
  /** The clearest shot to show a record for: confident, and not abstained. */
  exemplar: Shot | null;
}

export async function readHowItWorks(
  id = "game_1",
): Promise<HowItWorksData | null> {
  const file = path.join(process.cwd(), "public", "demo", id, `${id}.json`);
  try {
    const a = parseExportJson(await readFile(file, "utf8"));
    const byRally = new Map<number, number[]>();
    for (const s of a.shots) {
      const list = byRally.get(s.rally_id) ?? [];
      list.push(s.timestamp_s);
      byRally.set(s.rally_id, list);
    }
    const rallies = [...byRally.values()]
      .map((ts) => ({ start: Math.min(...ts), end: Math.max(...ts) }))
      .sort((x, y) => x.start - y.start);

    // The most confident non-abstained shot, so the record shown is one the
    // model actually stands behind. Serves are preferred against, because
    // their technique is also "serve" and the record then says the same thing
    // twice; a loop or a push shows that class and technique are different
    // answers.
    const confident = a.shots
      .filter((s) => !s.abstain)
      .sort((x, y) => y.class_confidence - x.class_confidence);
    const exemplar =
      confident.find((s) => s.technique !== s.shot_class) ??
      confident[0] ??
      null;

    return {
      durationS: a.duration_s,
      fps: Math.round(a.source_fps),
      shots: a.shots,
      rallies,
      activeS: rallies.reduce((n, r) => n + (r.end - r.start), 0),
      exemplar,
    };
  } catch {
    // The page still renders, just without the illustrations.
    return null;
  }
}
