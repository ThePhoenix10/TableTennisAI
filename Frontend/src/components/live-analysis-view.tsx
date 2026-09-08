"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnalysisScreen } from "./analysis-screen";

/** Job ids are `uuid4().hex[:16]`, the same shape the API enforces. */
const JOB_ID = /^[0-9a-f]{16}$/;

export function LiveAnalysisView() {
  const id = useSearchParams().get("id") ?? "";

  if (!JOB_ID.test(id)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="text-lg font-semibold">No analysis selected</h1>
        <p className="text-ink-muted mt-2 text-sm">
          This page needs a job id, for example{" "}
          <code className="font-mono text-xs">/analysis/job/?id=…</code>.
        </p>
        <Link href="/" className="text-brand-text mt-4 inline-block underline">
          Back to all videos
        </Link>
      </div>
    );
  }

  // Keyed so switching between analyses remounts with clean state rather than
  // resetting it inside an effect — the same reason the demo route keys it.
  return <AnalysisScreen key={id} id={id} live title="Your upload" />;
}
