"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, deleteJob, getSource, submitJob } from "@/lib/api";
import { ConfirmDialog } from "./confirm-dialog";
import type { Job, SourceVideo } from "@/lib/api-types";

/**
 * Plays an uploaded video, and offers to delete it.
 *
 * Built on the native <dialog> element: `showModal()` gives focus trapping,
 * Escape-to-close, inert background content and the top layer for free. Hand
 * -rolling that with a div is where accessible modals usually go wrong.
 */
/**
 * Statuses where the job belongs to a worker.
 *
 * The confirmation shown before submitting promises the video cannot be
 * deleted once queued, so the UI must not offer a Delete button that would
 * break that promise — regardless of whether the deployed API is old enough
 * to still allow it.
 */
const NOT_DELETABLE = ["queued", "validating", "processing"];

export function VideoOverlay({
  job,
  onClose,
  onDeleted,
  onSubmitted,
}: {
  job: Job;
  onClose: () => void;
  onDeleted: (jobId: string) => void;
  onSubmitted?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<SourceVideo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const [confirming, setConfirming] = useState<"analyse" | "delete" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Before submitting, both actions are available. Afterwards the job belongs
  // to a worker: the confirmation above promises it cannot be deleted while
  // queued, and the UI has to keep that promise.
  const actionable = job.status === "awaiting_upload";
  const deletable = !NOT_DELETABLE.includes(job.status);

  // showModal() is imperative and has no declarative equivalent, so this is a
  // genuine "synchronise with an external system" effect.
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  // The SAS is requested when the player opens, never with the list.
  useEffect(() => {
    let cancelled = false;
    getSource(job.job_id).then(
      (s) => {
        if (!cancelled) setSource(s);
      },
      (e: unknown) => {
        if (cancelled) return;
        setLoadError(
          e instanceof ApiError ? e.message : "Could not load this video.",
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [job.job_id]);

  async function run(what: "analyse" | "delete") {
    setBusy(true);
    setActionError(null);
    try {
      if (what === "analyse") {
        await submitJob(job.job_id);
        onSubmitted?.();
        ref.current?.close();
      } else {
        await deleteJob(job.job_id);
        onDeleted(job.job_id);
        ref.current?.close();
      }
      setConfirming(null);
    } catch (e: unknown) {
      setActionError(
        e instanceof ApiError ? e.message : `Could not ${what} this video.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      // Escape and the backdrop both route through onClose, so the parent
      // never has to track whether the dialog is still open.
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current.close();
      }}
      aria-labelledby="overlay-title"
      className="rounded-card bg-surface text-ink m-auto w-[min(56rem,92vw)] max-w-none p-0 backdrop:bg-black/60"
    >
      <div className="border-border flex items-start justify-between gap-4 border-b p-4">
        <h2 id="overlay-title" className="text-base font-semibold break-all">
          {job.filename ?? job.job_id}
        </h2>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="border-border shrink-0 cursor-pointer rounded border px-3 py-1 text-sm"
        >
          Close
        </button>
      </div>

      <div className="p-4">
        {loadError && (
          <p className="text-sm" style={{ color: "var(--color-attack)" }}>
            {loadError}
          </p>
        )}

        {!loadError && !source && (
          <p className="text-ink-muted text-sm">Loading video…</p>
        )}

        {source && !playbackError && (
          // User-uploaded match footage, so there is no caption track to add.
          <video
            src={source.url}
            controls
            autoPlay
            playsInline
            onError={() => setPlaybackError(true)}
            className="bg-bg max-h-[65vh] w-full rounded"
          />
        )}

        {playbackError && (
          <div className="border-border rounded border p-4 text-sm">
            <p className="font-medium">This browser cannot play this file.</p>
            <p className="text-ink-muted mt-1">
              The upload is intact — the codec just is not one this browser
              decodes. Analysis is unaffected; the worker uses ffmpeg.
            </p>
            <a
              href={source?.url}
              download={job.filename ?? undefined}
              className="text-brand-text mt-2 inline-block underline"
            >
              Download the file
            </a>
          </div>
        )}
      </div>

      {/* --- actions ------------------------------------------------------ */}
      {actionable && (
        <div className="border-border bg-bg/40 flex flex-wrap gap-2 border-t p-4">
          <button
            type="button"
            onClick={() => setConfirming("analyse")}
            className="bg-brand text-on-brand hover:bg-brand-hover cursor-pointer rounded px-4 py-2 text-sm font-medium"
          >
            Analyse
          </button>
          <button
            type="button"
            onClick={() => setConfirming("delete")}
            className="cursor-pointer rounded border px-4 py-2 text-sm font-medium"
            style={{
              color: "var(--color-attack)",
              borderColor: "var(--color-attack)",
            }}
          >
            Delete
          </button>
        </div>
      )}

      {/* Finished work stays deletable; nothing is reading it. */}
      {!actionable && deletable && (
        <div className="border-border bg-bg/40 border-t p-4">
          <button
            type="button"
            onClick={() => setConfirming("delete")}
            className="cursor-pointer rounded border px-3 py-1.5 text-sm font-medium"
            style={{
              color: "var(--color-attack)",
              borderColor: "var(--color-attack)",
            }}
          >
            Delete video
          </button>
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
        error={actionError}
        onConfirm={() => void run("analyse")}
        onCancel={() => {
          setConfirming(null);
          setActionError(null);
        }}
      />

      <ConfirmDialog
        open={confirming === "delete"}
        title="Delete this video?"
        body="The uploaded file and any analysis of it are removed permanently. This cannot be undone."
        confirmLabel="Delete video"
        destructive
        busy={busy}
        error={actionError}
        onConfirm={() => void run("delete")}
        onCancel={() => {
          setConfirming(null);
          setActionError(null);
        }}
      />
    </dialog>
  );
}
