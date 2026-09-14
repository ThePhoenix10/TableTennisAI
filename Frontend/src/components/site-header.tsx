"use client";

import Link from "next/link";
import { AccountMenu } from "./account-menu";
import { useSession } from "./session-provider";
import { useUploadAction } from "@/lib/use-upload-action";

/**
 * Global chrome. Deliberately thin — this is a data-dense product and the
 * density should come from the data, not the frame around it.
 */
export function SiteHeader() {
  const { user, ready, signOut } = useSession();
  const uploadVideo = useUploadAction();

  return (
    <header className="border-border bg-surface border-b">
      <a
        href="#main"
        className="focus:bg-brand focus:text-on-brand sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded text-base font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="bg-brand inline-block size-3 rounded-full"
          />
          PongAI
        </Link>

        <div className="ml-auto flex items-center gap-3">
          {/* Outlined, matching Sign in: both are secondary to Upload video,
              which stays the only filled control. Hidden on the narrowest
              screens, where it is one item too many beside a primary action
              and the account menu — the footer still carries it. */}
          <Link
            href="/how-it-works/"
            className="border-border hidden rounded border px-3 py-1.5 text-sm sm:inline-block"
          >
            How it works
          </Link>

          <button
            type="button"
            onClick={uploadVideo}
            className="bg-brand text-on-brand hover:bg-brand-hover cursor-pointer rounded px-3 py-1.5 text-sm font-medium"
          >
            Upload video
          </button>

          {/* Nothing account-related renders until the browser has read
              storage; the page is prerendered signed-out, so doing otherwise
              is a hydration mismatch. */}
          {ready &&
            (user ? (
              <AccountMenu user={user} onSignOut={signOut} />
            ) : (
              <Link
                href="/signin/"
                className="border-border rounded border px-3 py-1.5 text-sm"
              >
                Sign in
              </Link>
            ))}
        </div>
      </div>
    </header>
  );
}
