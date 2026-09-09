"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, deleteJob, getSource } from "@/lib/api";
import type { Job, SourceVideo } from "@/lib/api-types";

/**
 * Plays an uploaded video, and offers to delete it.
 *
 * Built on the native <dialog> element: `showModal()` gives focus trapping,
 * Escape-to-close, inert background content and the top layer for free. Hand
 * -rolling that with a div is where accessible modals usually go wrong.
 */
export function VideoOverlay({
  job,
  onClose,
  onDeleted,
}: {
  job: Job;
  onClose: () => void;
  onDeleted: (jobId: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<SourceVideo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteJob(job.job_id);
      onDeleted(job.job_id);
      ref.current?.close();
    } catch (e: unknown) {
      setDeleteError(
        e instanceof ApiError ? e.message : "Could not delete this video.",
      );
      setDeleting(false);
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

      {/* --- delete ------------------------------------------------------- */}
      <div className="border-border bg-bg/40 border-t p-4">
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="cursor-pointer rounded border px-3 py-1.5 text-sm font-medium"
            style={{
              color: "var(--color-attack)",
              borderColor: "var(--color-attack)",
            }}
          >
            Delete video
          </button>
        ) : (
          <div role="alertdialog" aria-labelledby="confirm-text">
            <p id="confirm-text" className="text-sm font-medium">
              Delete this video permanently?
            </p>
            <p className="text-ink-muted mt-1 text-sm">
              The uploaded file and any analysis of it are removed. This cannot
              be undone.
            </p>
            {deleteError && (
              <p
                className="mt-2 text-sm"
                style={{ color: "var(--color-attack)" }}
              >
                {deleteError}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="cursor-pointer rounded px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: "var(--color-attack)" }}
              >
                {deleting ? "Deleting…" : "Yes, delete it"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setConfirming(false);
                  setDeleteError(null);
                }}
                className="border-border cursor-pointer rounded border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                Keep it
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
