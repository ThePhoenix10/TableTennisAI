
import Link from "next/link";
import { WhatThisMeasures } from "@/components/what-this-measures";
import { formatClock } from "@/lib/analysis";
import {
  DEMO_MATCHES,
  MIN_VELOCITY_FPS,
  type DemoMatch,
} from "@/lib/constants";
import { readDemoStats, type DemoStats } from "@/lib/demo-stats";

function DemoCard({
  match,
  stats,
}: {
  match: DemoMatch;
  stats: DemoStats | null;
}) {
  return (
    <li>
      <Link
        href={`/analysis/${match.id}`}
        className="rounded-card border-border bg-surface hover:border-brand flex h-full flex-col overflow-hidden border transition-colors duration-150 ease-out"
      >
        {match.thumbUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element --
             a fixed-size static thumbnail already sized for this card;
             next/image would add a loader and layout machinery for no gain. */
          <img
            src={match.thumbUrl}
            alt=""
            width={640}
            height={360}
            className="bg-bg aspect-video w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="bg-bg border-border text-ink-subtle flex aspect-video w-full items-center justify-center border-b text-xs"
          >
            no footage
          </div>
        )}

        <div className="flex flex-1 flex-col p-5">
          <span className="flex items-center gap-2 text-base font-semibold">
            {match.title}
            {match.isSynthetic && (
              // Colour alone never carries meaning, so this is a word.
              <span className="border-border text-ink-muted rounded border px-1.5 py-0.5 text-xs font-normal">
                synthetic
              </span>
            )}
          </span>
          <span className="text-ink-muted mt-2 text-sm">{match.blurb}</span>

          {/* Every figure comes from the match JSON, so a card can never
              contradict the screen it links to. */}
          {stats && (
            <span
              data-numeric
              className="text-ink-muted mt-4 font-mono text-xs"
            >
              {formatClock(stats.durationS)} · {stats.shots} shots ·{" "}
              {stats.rallies} rallies · {stats.fps}fps
              {stats.fps < MIN_VELOCITY_FPS && " · no swing speed"}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

export default async function HomePage() {
  // Synthetic fixtures are deliberately NOT listed here. They remain in the
  // registry and stay reachable at /analysis/{id} as development fixtures —
  // they are the only data that exercises findings, evidence mode and the
  // 30fps velocity gate, since the real match is too short to produce any.
  const real = DEMO_MATCHES.filter((m) => !m.isSynthetic);
  const stats = new Map(
    await Promise.all(
      real.map(async (m) => [m.id, await readDemoStats(m.id)] as const),
    ),
  );

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
      <section className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">PongAI</h1>
        <p className="text-ink-muted mt-4 text-lg">
          Table-tennis video analysis from body pose alone. Every shot timed,
          attributed, classified and measured.
        </p>
      </section>

      <section aria-labelledby="demo-heading" className="mt-12">
        <h2 id="demo-heading" className="text-lg font-semibold">
          Try a demo
        </h2>
        <p className="text-ink-muted mt-1 text-sm">
          {real.length === 1
            ? "One real analysed match."
            : `${real.length} real analysed matches.`}{" "}
          Loads instantly — nothing is uploaded or processed.
        </p>

        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {real.map((match) => (
            <DemoCard
              key={match.id}
              match={match}
              stats={stats.get(match.id) ?? null}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="upload-heading" className="mt-12 max-w-2xl">
        <h2 id="upload-heading" className="text-lg font-semibold">
          Upload
        </h2>
        <div className="rounded-card border-border bg-surface mt-4 border p-5">
          <button
            type="button"
            disabled
            aria-describedby="upload-note"
            className="bg-brand text-on-brand rounded px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Upload a match
          </button>
          <p id="upload-note" className="text-ink-muted mt-3 text-sm">
            Upload is coming. For now, try the demo above.
          </p>
        </div>
      </section>

      <section className="mt-16 max-w-3xl">
        <WhatThisMeasures />
      </section>
    </div>
  );
}
