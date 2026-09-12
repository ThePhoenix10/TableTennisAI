"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { User } from "@/lib/api-types";

/** Initials, so the avatar says who is signed in without a photo to store. */
function initials(user: User): string {
  const a = user.first_name?.[0] ?? "";
  const b = user.last_name?.[0] ?? "";
  return (a + b).toUpperCase() || user.email[0].toUpperCase();
}

export function AccountMenu({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on an outside click or Escape. Both are expectations of a menu, and
  // neither comes for free on a div.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus(); // never strand the focus ring
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.full_name}`}
        className="border-border hover:border-brand flex size-9 cursor-pointer items-center justify-center rounded-full border text-xs font-semibold transition-colors"
      >
        <span aria-hidden>{initials(user)}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="rounded-card border-border bg-surface absolute right-0 z-50 mt-2 w-56 border p-1 shadow-sm"
        >
          <div className="border-border border-b px-3 py-2">
            <p className="truncate text-sm font-medium">{user.full_name}</p>
            <p className="text-ink-muted truncate text-xs">{user.email}</p>
          </div>

          <Link
            href="/profile/"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="hover:bg-bg block rounded px-3 py-2 text-sm"
          >
            View profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="hover:bg-bg block w-full cursor-pointer rounded px-3 py-2 text-left text-sm"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
