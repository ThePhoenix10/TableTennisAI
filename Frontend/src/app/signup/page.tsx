import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Create an account
      </h1>
      <p className="text-ink-muted mt-2 text-sm">
        You will need one to upload a match. The demos are open to everyone.
      </p>
      <div className="rounded-card border-border bg-surface mt-6 border p-6">
        {/* AuthForm reads ?next= via useSearchParams, which needs a boundary
            to prerender. */}
        <Suspense fallback={<p className="text-sm">Loading…</p>}>
          <AuthForm mode="signup" />
        </Suspense>
      </div>
    </div>
  );
}
