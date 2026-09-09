"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, createUpload, getLimits, uploadToBlob } from "@/lib/api";
import type { Limits, Rejection } from "@/lib/api-types";
import { probeVideoFile, toApiProbe, type ProbeResult } from "@/lib/probe";
import {
  blocking,
  validateAgainstLimits,
  warnings,
} from "@/lib/upload-validation";

type Phase = "idle" | "probing" | "ready" | "uploading" | "error";

const fmtMb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;
const fmtDuration = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Rejections render identically wherever they come from — browser or API. */
function RejectionList({
  items,
  tone,
}: {
  items: Rejection[];
  tone: "reject" | "warn";
}) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {items.map((r, i) => (
        <li
          key={`${r.code}-${i}`}
          className={`rounded border p-3 text-sm ${
            tone === "reject"
              ? "border-[color:var(--color-attack)]/40 bg-[color:var(--color-attack)]/5"
              : "border-[color:var(--color-defence)]/40 bg-[color:var(--color-defence)]/5"
          }`}
        >
          {/* A word, not just a colour — colour never carries meaning alone. */}
          <span
            className="font-semibold"
            style={{
              color:
                tone === "reject"
                  ? "var(--color-attack)"
                  : "var(--color-defence)",
            }}
          >
            {tone === "reject" ? "Cannot upload" : "Heads up"}
          </span>
          <span className="mt-1 block">{r.message}</span>
          {r.detail && (
            <span className="text-ink-muted mt-1 block text-xs">
              {r.detail}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function UploadPanel({ onUploaded }: { onUploaded: () => void }) {
  const [limits, setLimits] = useState<Limits | null>(null);
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [issues, setIssues] = useState<Rejection[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The limits drive validation, so they are fetched once up front rather than
  // at submit time — the picker should not accept a file it already knows is
  // too big.
  useEffect(() => {
    getLimits()
      .then(setLimits)
      .catch((e: unknown) =>
        setLimitsError(
          e instanceof ApiError ? e.message : "Could not reach the API.",
        ),
      );
  }, []);

  const reset = () => {
    setPhase("idle");
    setFile(null);
    setProbe(null);
    setIssues([]);
    setProgress(0);
    setError(null);
  };

  const accept = useCallback(
    async (f: File) => {
      if (!limits) return;
      setFile(f);
      setError(null);
      setIssues([]);
      setPhase("probing");
      try {
        const p = await probeVideoFile(f);
        setProbe(p);
        setIssues(validateAgainstLimits(f, p, limits));
        setPhase("ready");
      } catch (e: unknown) {
        setProbe(null);
        setIssues([
          {
            code: "unreadable",
            severity: "reject",
            message:
              e instanceof Error
                ? e.message
                : "This file could not be read as a video.",
          },
        ]);
        setPhase("ready");
      }
    },
    [limits],
  );

  async function startUpload() {
    if (!file || !limits) return;
    setPhase("uploading");
    setProgress(0);
    setError(null);
    abortRef.current = new AbortController();

    try {
      const contentType = file.type || "video/mp4";
      const created = await createUpload({
        filename: file.name,
        size_bytes: file.size,
        content_type: contentType,
        probe: probe ? toApiProbe(file, probe) : null,
      });

      // Any warning the API returns replaces ours: it validated the same probe
      // with the authoritative rules.
      if (created.warnings.length > 0) setIssues(created.warnings);

      await uploadToBlob(
        created.upload_url,
        file,
        contentType,
        setProgress,
        abortRef.current.signal,
      );

      // Straight back to an empty picker. The upload's own confirmation is
      // the video appearing in the list beside this panel, so holding a
      // "done" screen here just leaves stale details on the page and an
      // extra click between the user and their next upload.
      reset();
      onUploaded();
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        reset();
        return;
      }
      if (e instanceof ApiError && e.rejections.length > 0) {
        // The API refused it — show its wording, which is the same ruleset.
        setIssues(e.rejections);
        setPhase("ready");
        return;
      }
      setError(e instanceof Error ? e.message : "The upload failed.");
      setPhase("error");
    }
  }

  const blockers = blocking(issues);
  const warns = warnings(issues);
  const canUpload = phase === "ready" && file != null && blockers.length === 0;

  if (limitsError) {
    return (
      <div className="rounded-card border-border bg-surface border p-5">
        <p className="text-sm font-semibold">The API is not reachable.</p>
        <p className="text-ink-muted mt-1 text-sm">{limitsError}</p>
        <p className="text-ink-muted mt-2 text-xs">
          Start the backend, then reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border-border bg-surface border p-5">
      {/* --- picker ------------------------------------------------------ */}
      {(phase === "idle" || phase === "probing") && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void accept(f);
          }}
          className={`rounded border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? "border-brand bg-brand/5" : "border-border"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void accept(f);
              e.target.value = ""; // so re-picking the same file re-fires
            }}
          />
          <button
            type="button"
            disabled={!limits || phase === "probing"}
            onClick={() => inputRef.current?.click()}
            className="bg-brand text-on-brand hover:bg-brand-hover cursor-pointer rounded px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "probing" ? "Reading the video…" : "Choose a video"}
          </button>
          <p className="text-ink-muted mt-3 text-sm">
            or drag one here
            {limits && (
              <>
                {" · "}up to {fmtMb(limits.max_size_bytes)} and{" "}
                {Math.round(limits.max_duration_s / 60)} minutes
              </>
            )}
          </p>
          {limits && (
            <p className="text-ink-subtle mt-2 text-xs">
              {limits.guidance.camera}
            </p>
          )}
        </div>
      )}

      {/* --- what we measured -------------------------------------------- */}
      {file && phase !== "idle" && (
        <div className="border-border flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-3 text-sm">
          <span className="font-medium break-all">{file.name}</span>
          <span data-numeric className="text-ink-muted font-mono text-xs">
            {fmtMb(file.size)}
            {probe && probe.duration_s > 0 && (
              <> · {fmtDuration(probe.duration_s)}</>
            )}
            {probe && probe.width > 0 && (
              <>
                {" "}
                · {probe.width}×{probe.height}
              </>
            )}
            {probe?.fps != null && <> · {Math.round(probe.fps)}fps</>}
          </span>
          {probe?.fps == null && phase === "ready" && (
            <span className="text-ink-subtle text-xs">
              frame rate is above this display&rsquo;s refresh rate — the server
              will measure it exactly
            </span>
          )}
        </div>
      )}

      <RejectionList items={blockers} tone="reject" />
      <RejectionList items={warns} tone="warn" />

      {/* --- progress ----------------------------------------------------- */}
      {phase === "uploading" && (
        <div className="mt-4">
          <div
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
            className="bg-bg h-2 w-full overflow-hidden rounded"
          >
            <div
              className="bg-brand h-full transition-[width] duration-150"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <p aria-live="polite" className="text-ink-muted mt-2 text-sm">
            Uploading… {Math.round(progress * 100)}%
          </p>
        </div>
      )}

      {phase === "error" && error && (
        <p aria-live="polite" className="mt-4 text-sm">
          <span
            className="font-semibold"
            style={{ color: "var(--color-attack)" }}
          >
            Upload failed
          </span>{" "}
          {error}
        </p>
      )}

      {/* --- actions ------------------------------------------------------ */}
      {phase !== "idle" && phase !== "probing" && (
        <div className="mt-4 flex flex-wrap gap-2">
          {canUpload && (
            <button
              type="button"
              onClick={() => void startUpload()}
              className="bg-brand text-on-brand hover:bg-brand-hover cursor-pointer rounded px-4 py-2 text-sm font-medium"
            >
              Upload
            </button>
          )}
          {phase === "uploading" ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="border-border cursor-pointer rounded border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={reset}
              className="border-border cursor-pointer rounded border px-4 py-2 text-sm font-medium"
            >
              Choose a different file
            </button>
          )}
        </div>
      )}
    </div>
  );
}
