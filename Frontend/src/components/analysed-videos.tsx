"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAnalysis } from "@/lib/api";
import type { Analysis, Job } from "@/lib/api-types";
import { formatClock } from "@/lib/analysis";
import { MIN_VELOCITY_FPS } from "@/lib/constants";

/**
 * Finished analyses, presented the way the demo matches are.
 *
 * Every figure comes from the analysis itself rather than the job row, so a
 * card can never contradict the screen it links to — the same rule the demo
 * cards follow.
 */
function AnalysedCard({ job, analysis }: { job: Job; analysis: Analysis }) {
  const m = analysis.meta;
  return (
    <li>
      <Link
        href={`/analysis/job/?id=${job.job_id}`}
        className="rounded-card border-border bg-surface hover:border-brand flex h-full flex-col overflow-hidden border transition-colors duration-150 ease-out"
      >
        {analysis.thumb_url ? (
          /* eslint-disable-next-line @next/next/no-img-element --
             a signed, already-sized thumbnail; next/image would add a loader
             and cannot handle an expiring URL. */
          <img
            src={analysis.thumb_url}
            alt=""
            width={640}
            height={360}
            className="bg-bg aspect-video w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="bg-bg border-border text-ink-subtle flex aspect-video w-full items-center justify-center border-b text-xs"
          >
            no thumbnail
          </div>
        )}

        <div className="flex flex-1 flex-col p-5">
          <span className="text-base font-semibold break-all">
            {job.filename ?? m.video_id}
          </span>
          <span className="text-ink-muted mt-2 text-sm">
            Your upload, analysed by the pipeline.
          </span>
          <span data-numeric className="text-ink-muted mt-4 font-mono text-xs">
            {formatClock(m.duration_s)} · {m.n_shots} shots · {m.n_rallies}{" "}
            rallies · {Math.round(m.source_fps)}fps
            {/* Served as a computed field, so the rule is not re-derived. */}
            {!m.velocity_reliable && " · no swing speed"}
          </span>
          {m.source_fps < MIN_VELOCITY_FPS && (
            <span className="text-ink-subtle mt-1 text-xs">
              Swing-speed metrics withheld below {MIN_VELOCITY_FPS}fps.
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

export function AnalysedVideos({ jobs }: { jobs: Job[] }) {
  const [analyses, setAnalyses] = useState<Map<string, Analysis>>(new Map());

  const doneIds = jobs
    .filter((j) => j.status === "done")
    .map((j) => j.job_id)
    .join(",");

  // One request per finished job, and only for ones not already held. The
  // shot counts and the thumbnail live in the analysis, not the job row.
  useEffect(() => {
    if (!doneIds) return;
    let cancelled = false;
    const wanted = doneIds.split(",");

    Promise.all(
      wanted.map((id) =>
        getAnalysis(id).then(
          (a) => [id, a] as const,
          // A finished job whose results cannot be read is a real failure, but
          // it should cost one card, not the section.
          () => null,
        ),
      ),
    ).then((rows) => {
      if (cancelled) return;
      setAnalyses(
        new Map(
          rows.filter((r): r is readonly [string, Analysis] => r !== null),
        ),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [doneIds]);

  const done = jobs.filter((j) => j.status === "done");
  if (done.length === 0) return null;

  return (
    <section aria-labelledby="analysed-heading" className="mt-12">
      <h2 id="analysed-heading" className="text-lg font-semibold">
        Analysed videos
      </h2>
      <p className="text-ink-muted mt-1 text-sm">
        {done.length} finished {done.length === 1 ? "analysis" : "analyses"}.
        Every shot timed, attributed, classified and measured.
      </p>

      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {done.map((job) => {
          const a = analyses.get(job.job_id);
          return a ? (
            <AnalysedCard key={job.job_id} job={job} analysis={a} />
          ) : (
            <li
              key={job.job_id}
              className="rounded-card border-border bg-surface text-ink-muted border p-5 text-sm"
            >
              {job.filename ?? job.job_id}
              <span className="mt-2 block text-xs">Loading results…</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
