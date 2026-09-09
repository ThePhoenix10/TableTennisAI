"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, listJobs } from "@/lib/api";
import type { Job } from "@/lib/api-types";
import { AnalysedVideos } from "./analysed-videos";
import { UploadPanel } from "./upload-panel";
import { UploadedVideos } from "./uploaded-videos";

/**
 * Owns the job list for the whole home page.
 *
 * Both sections read the same fetch: two independent pollers against Table
 * Storage would double the reads and could disagree with each other for a
 * couple of seconds after a submit, which reads as a video briefly existing
 * in two places.
 */

/** Slow enough not to hammer Table Storage, fast enough to feel live. The
 *  per-job SSE stream is the precise version; this list only needs the gist. */
const POLL_MS = 4000;

export function UploadSection() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const message = (e: unknown) =>
    e instanceof ApiError ? e.message : "Could not load your videos.";

  /** The Refresh button. An event handler, so it may set state directly. */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setJobs(await listJobs(50));
      setError(null);
    } catch (e: unknown) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Polls while any job is in flight and stops once everything is terminal —
  // a list of finished analyses has nothing to poll for.
  //
  // State is set only in the settlement callbacks, never in the effect body:
  // a synchronous setState here would cascade renders.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const poll = () => {
      listJobs(50).then(
        (j) => {
          if (cancelled) return;
          setJobs(j);
          setError(null);
          // `is_terminal` is computed server-side, so the terminal set is not
          // re-derived here. awaiting_upload is not terminal, but nothing
          // moves it either, so it does not count as in flight.
          const active = j.some(
            (x) => !x.is_terminal && x.status !== "awaiting_upload",
          );
          if (active) timer = window.setTimeout(poll, POLL_MS);
        },
        (e: unknown) => {
          if (cancelled) return;
          setError(message(e));
          timer = window.setTimeout(poll, POLL_MS * 3);
        },
      );
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [refreshKey]);

  const pending = jobs?.filter((j) => j.status !== "done") ?? null;

  return (
    <>
      {/* Upload and the queue side by side: what you just did and what it did
          next belong in one glance. They stack below lg, where two columns
          would leave neither readable. The divider is a border on the right
          column rather than a separate element, so it cannot fall out of step
          with the gap. */}
      <div className="mt-12 grid gap-8 lg:grid-cols-2 lg:gap-10">
        <section aria-labelledby="upload-heading">
          <h2 id="upload-heading" className="text-lg font-semibold">
            Upload
          </h2>
          <p className="text-ink-muted mt-1 text-sm">
            Checked in the browser first, so a clip that cannot work is caught
            before it is uploaded rather than after.
          </p>
          <div className="mt-4">
            <UploadPanel onUploaded={() => setRefreshKey((k) => k + 1)} />
          </div>
        </section>

        <section
          aria-labelledby="uploaded-heading"
          className="border-border lg:border-l lg:pl-10"
        >
          <h2 id="uploaded-heading" className="text-lg font-semibold">
            Videos uploaded
          </h2>
          <p className="text-ink-muted mt-1 text-sm">
            Click a video to play it, or analyse it when you are ready.
          </p>
          <div className="mt-4">
            <UploadedVideos
              jobs={pending}
              error={error}
              loading={loading}
              onReload={() => void reload()}
              onDropped={(id) =>
                setJobs((prev) => prev?.filter((j) => j.job_id !== id) ?? null)
              }
            />
          </div>
        </section>
      </div>

      {/* Full width: these are cards in a grid, and they are the payoff. */}
      {jobs && <AnalysedVideos jobs={jobs} />}
    </>
  );
}
