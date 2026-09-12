import Link from "next/link";
import { formatClock } from "@/lib/analysis";
import type { DemoStats } from "@/lib/demo-stats";

/**
 * What the analysis screen actually looks like.
 *
 * A real capture of /analysis/game_1, not a mock-up. It will drift as the UI
 * changes — see public/hero/README.md for how to retake it.
 */
export function DashboardGlimpse({ stats }: { stats: DemoStats | null }) {
  return (
    <section
      aria-labelledby="glimpse-heading"
      className="mx-auto max-w-[1280px] px-4 pt-16 sm:px-6"
    >
      <div className="max-w-2xl">
        <h2 id="glimpse-heading" className="text-xl font-semibold">
          What you get back
        </h2>
        <p className="text-ink-muted mt-2">
          Every shot on a timeline, both players tracked side by side, and the
          measurements behind each one, with the model&rsquo;s own accuracy
          stated next to its claims.
        </p>
      </div>

      <div className="rounded-card border-border bg-surface relative mt-8 overflow-hidden border">
        {/* eslint-disable-next-line @next/next/no-img-element --
            a fixed-size screenshot; next/image would add a loader for no gain. */}
        <img
          src="/hero/dashboard.jpg"
          alt="The PongAI analysis screen: a match video with both players' skeletons tracked, player panels either side, and a timeline of every shot below."
          width={1440}
          height={704}
          className="w-full"
        />
        {/* Fades the cut edge rather than ending on a hard crop. */}
        <div
          aria-hidden
          className="from-surface pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t to-transparent"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
        {stats && (
          <p data-numeric className="text-ink-muted font-mono text-xs">
            {formatClock(stats.durationS)} · {stats.shots} shots ·{" "}
            {stats.rallies} rallies · {stats.fps}fps
          </p>
        )}
        <Link
          href="/analysis/game_1/"
          className="text-brand-text text-sm underline"
        >
          Open the full analysis →
        </Link>
      </div>
    </section>
  );
}
