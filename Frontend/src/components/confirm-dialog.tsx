"use client";

import { useEffect, useRef } from "react";

/**
 * A modal confirmation, on the native <dialog> element.
 *
 * showModal() gives focus trapping, Escape-to-close, inert background content
 * and top-layer stacking for free. Hand-rolling those on a div is where
 * accessible modals usually go wrong.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Colours the confirm button as a warning and nothing else. */
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // showModal() is imperative with no declarative equivalent, so this is a
  // genuine "synchronise with an external system" effect.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      onClick={(e) => {
        // Backdrop click cancels, but never while a request is in flight.
        if (e.target === ref.current && !busy) onCancel();
      }}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      aria-labelledby="confirm-title"
      className="rounded-card bg-surface text-ink m-auto w-[min(28rem,92vw)] p-0 backdrop:bg-black/50"
    >
      <div className="p-5">
        <h2 id="confirm-title" className="text-base font-semibold">
          {title}
        </h2>
        <div className="text-ink-muted mt-2 text-sm">{body}</div>

        {error && (
          <p className="mt-3 text-sm" style={{ color: "var(--color-attack)" }}>
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="border-border cursor-pointer rounded border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`cursor-pointer rounded px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
              destructive
                ? "text-white"
                : "bg-brand text-on-brand hover:bg-brand-hover"
            }`}
            style={
              destructive
                ? { backgroundColor: "var(--color-attack)" }
                : undefined
            }
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
