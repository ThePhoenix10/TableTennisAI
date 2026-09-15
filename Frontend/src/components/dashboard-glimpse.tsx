import Link from "next/link";
import { formatClock } from "@/lib/analysis";
import type { DemoStats } from "@/lib/demo-stats";

export function DashboardGlimpse({ stats }: { stats: DemoStats | null }) {
  return (
    <section aria-labelledby="glimpse-heading" className="mx-auto max-w-[1280px] px-4 pt-20 sm:px-6">
      <div className="max-w-2xl">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-600">
          <span className="inline-block size-1.5 rounded-full bg-orange-500" />
          Live demo
        </div>
        <h2 id="glimpse-heading" className="text-xl font-bold text-slate-900">See it in action</h2>
        <p className="mt-2 text-slate-500">
          Every shot on a timeline, both players tracked side by side, and the
          measurements behind each one, with the model&rsquo;s own accuracy stated next to its claims.
        </p>
      </div>

      <div className="relative mt-8 overflow-hidden rounded-2xl border border-slate-200 shadow-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hero/dashboard.jpg"
          alt="The PongAI analysis screen: a match video with both players' skeletons tracked, player panels either side, and a timeline of every shot below."
          width={1440}
          height={704}
          className="w-full"
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-50 to-transparent" />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {stats && (
          <div className="flex items-center gap-4">
            {[
              { label: formatClock(stats.durationS), sub: "duration" },
              { label: `${stats.shots}`, sub: "shots" },
              { label: `${stats.rallies}`, sub: "rallies" },
              { label: `${stats.fps}fps`, sub: "frame rate" },
            ].map((s) => (
              <div key={s.sub} className="flex items-baseline gap-1.5">
                <span data-numeric className="font-mono text-sm font-semibold text-slate-800">{s.label}</span>
                <span className="text-xs text-slate-400">{s.sub}</span>
              </div>
            ))}
          </div>
        )}
        <Link href="/analysis/game_1/" className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:text-orange-700 transition-colors">
          Open the full analysis <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}