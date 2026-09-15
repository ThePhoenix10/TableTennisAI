import Link from "next/link";
import { formatClock } from "@/lib/analysis";
import type { DemoStats } from "@/lib/demo-stats";

export function DashboardGlimpse({ stats }: { stats: DemoStats | null }) {
  return (
    <section aria-labelledby="glimpse-heading" className="bg-white border-b border-slate-100">
      <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6">

        {/* Header row */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-10">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-600">
              <span className="inline-block size-1.5 rounded-full bg-orange-500" />
              Live demo — no sign-in needed
            </div>
            <h2 id="glimpse-heading" className="text-2xl font-bold text-slate-900">See a real match analysis</h2>
            <p className="mt-2 text-slate-500 max-w-lg">
              Every shot on a timeline, both players tracked side by side, measurements behind each one — with the model's own accuracy stated next to its claims.
            </p>
          </div>
          <Link
            href="/analysis/game_1/"
            className="shrink-0 inline-flex items-center gap-2 rounded-xl gradient-brand px-5 py-2.5 text-sm font-bold text-white glow-brand hover:opacity-90 transition-opacity"
          >
            Open full analysis
            <span aria-hidden>→</span>
          </Link>
        </div>

        {/* Dashboard screenshot */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-2xl ring-1 ring-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero/dashboard.jpg"
            alt="The PongAI analysis screen: match video with both players' skeletons tracked, player panels either side, and a shot timeline below."
            width={1440}
            height={704}
            className="w-full"
          />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white to-transparent" />
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-2">
            {[
              { label: formatClock(stats.durationS), sub: "match duration" },
              { label: `${stats.shots}`, sub: "shots detected" },
              { label: `${stats.rallies}`, sub: "rallies" },
              { label: `${stats.fps}fps`, sub: "frame rate" },
            ].map((s) => (
              <div key={s.sub} className="flex items-baseline gap-1.5">
                <span data-numeric className="font-mono text-sm font-bold text-slate-800">{s.label}</span>
                <span className="text-xs text-slate-400">{s.sub}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}