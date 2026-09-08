import { Suspense } from "react";
import type { Metadata } from "next";
import { LiveAnalysisView } from "@/components/live-analysis-view";

export const metadata: Metadata = { title: "Analysis" };

/**
 * An analysed upload.
 *
 * Why the job id is a query parameter rather than a path segment:
 * `next.config.ts` sets `output: "export"`, so every route is prerendered at
 * build time from `generateStaticParams`. Job ids are created at runtime and
 * cannot be known then, so `/analysis/{job_id}` has no file to serve and 404s
 * on any static host. A static route reading `?id=` works identically in
 * `next dev`, in the exported bundle and on Static Web Apps, with no
 * host-specific rewrite rules to keep in sync.
 *
 * A static segment takes precedence over the sibling `[id]` route, so the
 * demo pages are unaffected.
 */
export default function LiveAnalysisPage() {
  return (
    // useSearchParams needs a Suspense boundary to prerender.
    <Suspense fallback={<p className="p-8 text-sm">Loading…</p>}>
      <LiveAnalysisView />
    </Suspense>
  );
}
