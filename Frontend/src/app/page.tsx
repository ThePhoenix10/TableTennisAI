import Link from "next/link";
import { WhatThisMeasures } from "@/components/what-this-measures";
import { DEMO_MATCHES, MIN_VELOCITY_FPS } from "@/lib/constants";

export default function HomePage() {
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
          Three precomputed matches. They load instantly — nothing is uploaded
          or processed.
        </p>

        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DEMO_MATCHES.map((match) => (
            <li key={match.id}>
              <Link
                href={`/analysis/${match.id}`}
                className="rounded-card border-border bg-surface hover:border-brand flex h-full flex-col border p-5 transition-colors duration-150 ease-out"
              >
                <span className="text-base font-semibold">{match.title}</span>
                <span className="text-ink-muted mt-2 text-sm">
                  {match.summary}
                </span>
                <span
                  data-numeric
                  className="text-ink-muted mt-4 font-mono text-xs"
                >
                  {match.durationLabel} · {match.fps}fps
                  {match.fps < MIN_VELOCITY_FPS ? " · no swing speed" : ""}
                </span>
              </Link>
            </li>
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
            Upload is coming. For now, try the demo matches.
          </p>
        </div>
      </section>

      <section className="mt-16 max-w-3xl">
        <WhatThisMeasures />
      </section>
    </div>
  );
}
