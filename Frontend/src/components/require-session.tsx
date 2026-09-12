"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "./session-provider";
import { signInUrl } from "@/lib/auth";

/**
 * Gate a page on a session.
 *
 * The site is a static export, so there is no server to redirect before the
 * page is served: every route is public HTML and the guard runs in the
 * browser. That is fine because the data is guarded where it matters — the
 * API returns 401 without a token and 404 for another account's job — so this
 * is about not showing an empty shell, not about secrecy.
 */
export function RequireSession({
  children,
  returnTo,
}: {
  children: React.ReactNode;
  returnTo: string;
}) {
  const { user, ready } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace(signInUrl(returnTo));
  }, [ready, user, router, returnTo]);

  if (!ready) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
        <p className="text-ink-muted text-sm">Loading…</p>
      </div>
    );
  }

  if (!user) {
    // The redirect is already in flight; this is what shows if it is blocked.
    return (
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <h1 className="text-lg font-semibold">Sign in to continue</h1>
        <p className="text-ink-muted mt-2 text-sm">
          This page needs an account.
        </p>
        <Link
          href={signInUrl(returnTo)}
          className="bg-brand text-on-brand mt-4 inline-block rounded px-4 py-2 text-sm font-medium"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
