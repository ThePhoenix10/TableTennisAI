"use client";

import { useState } from "react";
import { ApiError, deleteJob, submitJob } from "@/lib/api";
import type { Job, JobStatus } from "@/lib/api-types";
import { ConfirmDialog } from "./confirm-dialog";
import { VideoOverlay } from "./video-overlay";

/**
 * Every job on the account, newest first.
 *
 * There is no auth, so this is genuinely everyone's uploads — fine while the
 * project is private, and worth revisiting before it is not.
 */

/**
 * Status wording, and why `awaiting_upload` is not called "failed".
 *
 * The frontend does not call POST /jobs/{id}/submit yet, so a job stays in
 * `awaiting_upload` even after its file has landed in blob storage: the API
 * only learns the upload finished when something submits it. Saying "not
 * submitted" is the honest description of what the backend knows.
 */
const STATUS_META: Record<JobStatus, { label: string; colorVar?: string }> = {
  awaiting_upload: { label: "Not submitted" },
  queued: { label: "Queued" },
  validating: { label: "Checking the video" },
  processing: { label: "Analysing" },
  done: { label: "Analysed", colorVar: "var(--color-control)" },
  failed: { label: "Failed", colorVar: "var(--color-attack)" },
  rejected: { label: "Not usable", colorVar: "var(--color-defence)" },
};

/** "about 4 minutes left" reads better than a countdown that jitters. */
function fmtEta(seconds: number): string {
  if (seconds < 60) return "under a minute left";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `about ${mins} minute${mins === 1 ? "" : "s"} left`;
  const hrs = Math.round(mins / 6) / 10;
  return `about ${hrs} hour${hrs === 1 ? "" : "s"} left`;
}

/**
 * Live progress for a job the worker is actually running.
 *
 * Every value is served by the API: the percentage is weighted by measured
 * stage cost, and the wording is the same `stage_label` the SSE stream sends.
 */
function ProgressBar({ job }: { job: Job }) {
  const pct = Math.round(job.progress * 100);
  return (
    <div className="mt-3">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={job.stage_label ?? "Analysis progress"}
        className="bg-bg h-2 w-full overflow-hidden rounded"
      >
        <div
          className="bg-brand h-full transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* aria-live so the percentage is announced as it changes, not just
          rendered. */}
      <p aria-live="polite" className="text-ink-muted mt-2 text-xs">
        <span data-numeric className="font-mono">
          {pct}%
        </span>
        {job.stage_label && ` · ${job.stage_label}`}
        {job.eta_s != null && job.eta_s > 0 && ` · ${fmtEta(job.eta_s)}`}
      </p>
    </div>
  );
}

const fmtMb = (b: number | null) =>
  b == null ? "—" : `${(b / 1e6).toFixed(1)} MB`;

function fmtWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

function JobRow({
  job,
  onOpen,
  onSubmitted,
  onDeleted,
}: {
  job: Job;
  onOpen: (j: Job) => void;
  onSubmitted: () => void;
  onDeleted: (jobId: string) => void;
}) {
  const meta = STATUS_META[job.status];
  const probe = job.probe ?? job.client_probe;
  const [confirming, setConfirming] = useState<"analyse" | "delete" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only before submitting. Once queued the job belongs to a worker, and the
  // API refuses both actions.
  const actionable = job.status === "awaiting_upload";

  async function run(what: "analyse" | "delete") {
    setBusy(true);
    setError(null);
    try {
      if (what === "analyse") {
        await submitJob(job.job_id);
        onSubmitted();
      } else {
        await deleteJob(job.job_id);
        onDeleted(job.job_id);
      }
      setConfirming(null);
    } catch (e: unknown) {
      // A truncated upload surfaces here, with the API's own wording.
      setError(
        e instanceof ApiError ? e.message : `Could not ${what} this video.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-card border-border bg-surface hover:border-brand border transition-colors">
      {/* The whole card is the control, so the hit area matches what looks
          clickable. A button rather than a link: this opens a dialog, it does
          not navigate. */}
      <button
        type="button"
        onClick={() => onOpen(job)}
        className="w-full cursor-pointer p-4 text-left"
        aria-label={`Play ${job.filename ?? job.job_id}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-medium break-all">
            {job.filename ?? job.job_id}
          </span>
          {/* The status is a word first; colour only reinforces it. */}
          <span
            className="border-border rounded border px-2 py-0.5 text-xs font-medium"
            style={meta.colorVar ? { color: meta.colorVar } : undefined}
          >
            {meta.label}
          </span>
        </div>

        <div data-numeric className="text-ink-muted mt-2 font-mono text-xs">
          {fmtMb(job.size_bytes)}
          {probe && probe.duration_s > 0 && (
            <>
              {" "}
              · {Math.floor(probe.duration_s / 60)}:
              {String(Math.floor(probe.duration_s % 60)).padStart(2, "0")}
            </>
          )}
          {probe && probe.width > 0 && (
            <>
              {" "}
              · {probe.width}×{probe.height}
            </>
          )}
          {probe && probe.fps > 0 && <> · {Math.round(probe.fps)}fps</>}
          {" · "}
          {fmtWhen(job.created_at)}
        </div>

        {probe && probe.fps > 0 && !probe.velocity_reliable && (
          // Served by the API as a computed field, so the 60fps rule is not
          // re-derived here.
          <p className="text-ink-muted mt-2 text-xs">
            Swing-speed metrics will be withheld at this frame rate.
          </p>
        )}

        {(job.status === "processing" || job.status === "validating") && (
          <ProgressBar job={job} />
        )}

        {/* The worker scales to zero, so the first job after an idle period
            waits for a node and an ~875 MB image pull before any stage starts.
            Several minutes of bare "Queued" reads as a failure. */}
        {job.status === "queued" && (
          <p className="text-ink-muted mt-3 text-xs">
            Waiting for a worker. The first analysis after an idle period takes
            a few minutes to start.
          </p>
        )}

        {job.rejections.map((r, i) => (
          <p key={i} className="mt-2 text-xs">
            <span style={{ color: "var(--color-defence)" }}>{r.message}</span>
          </p>
        ))}
        {job.error_message && (
          <p className="mt-2 text-xs" style={{ color: "var(--color-attack)" }}>
            {job.error_message}
          </p>
        )}
      </button>

      {/* Actions sit outside the card button — a button inside a button is
          invalid HTML and breaks keyboard navigation. Shown rather than
          revealed on hover, so it is obvious the video can be acted on
          without discovering it by accident. */}
      {actionable && (
        <div className="border-border flex flex-wrap items-center gap-2 border-t px-4 py-3">
          <button
            type="button"
            onClick={() => setConfirming("analyse")}
            className="bg-brand text-on-brand hover:bg-brand-hover cursor-pointer rounded px-3 py-1.5 text-sm font-medium"
          >
            Analyse
          </button>
          <button
            type="button"
            onClick={() => setConfirming("delete")}
            className="cursor-pointer rounded border px-3 py-1.5 text-sm font-medium"
            style={{
              color: "var(--color-attack)",
              borderColor: "var(--color-attack)",
            }}
          >
            Delete
          </button>
          <span className="text-ink-subtle ml-auto text-xs">
            Click the card to play it
          </span>
        </div>
      )}

      <ConfirmDialog
        open={confirming === "analyse"}
        title="Send this video for analysis?"
        body={
          <>
            <p>
              Analysis takes about five times the length of the clip once a
              worker picks it up.
            </p>
            <p className="mt-2">
              <strong>You will not be able to delete it</strong> while it is
              queued or being analysed.
            </p>
          </>
        }
        confirmLabel="Analyse"
        busy={busy}
        error={error}
        onConfirm={() => void run("analyse")}
        onCancel={() => {
          setConfirming(null);
          setError(null);
        }}
      />

      <ConfirmDialog
        open={confirming === "delete"}
        title="Delete this video?"
        body="The uploaded file is removed permanently. This cannot be undone."
        confirmLabel="Delete video"
        destructive
        busy={busy}
        error={error}
        onConfirm={() => void run("delete")}
        onCancel={() => {
          setConfirming(null);
          setError(null);
        }}
      />
    </li>
  );
}

export function UploadedVideos({
  jobs,
  error,
  loading,
  onReload,
  onDropped,
}: {
  /** Only the jobs still awaiting analysis; finished ones get their own
   *  section, so a video never appears in two places at once. */
  jobs: Job[] | null;
  error: string | null;
  loading: boolean;
  onReload: () => void;
  onDropped: (jobId: string) => void;
}) {
  const [open, setOpen] = useState<Job | null>(null);

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-ink-muted text-sm">
          {jobs == null
            ? "Loading…"
            : jobs.length === 0
              ? "Nothing waiting."
              : `${jobs.length} video${jobs.length === 1 ? "" : "s"} waiting, newest first.`}
        </p>
        <button
          type="button"
          onClick={onReload}
          disabled={loading}
          className="border-border cursor-pointer rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-sm" style={{ color: "var(--color-attack)" }}>
          {error}
        </p>
      )}

      {jobs && jobs.length > 0 && (
        <ul className="mt-4 space-y-3">
          {jobs.map((j) => (
            <JobRow
              key={j.job_id}
              job={j}
              onOpen={setOpen}
              onSubmitted={onReload}
              onDeleted={onDropped}
            />
          ))}
        </ul>
      )}

      {open && (
        <VideoOverlay
          // Remounts per job, so the player never shows the previous video
          // while the new link is still being signed.
          key={open.job_id}
          job={open}
          onClose={() => setOpen(null)}
          onDeleted={(id) => {
            // Dropped locally rather than refetched: the row should go the
            // instant the delete succeeds, not after a round trip.
            onDropped(id);
            setOpen(null);
          }}
        />
      )}
    </>
  );
}
