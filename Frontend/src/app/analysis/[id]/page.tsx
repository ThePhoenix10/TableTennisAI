import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_MATCHES } from "@/lib/constants";

export function generateStaticParams() {
  return DEMO_MATCHES.map((match) => ({ id: match.id }));
}

/** Only the precomputed demo matches exist in v1. */
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: PageProps<"/analysis/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: id };
}

export default async function AnalysisPage({
  params,
}: PageProps<"/analysis/[id]">) {
  const { id } = await params;
  const match = DEMO_MATCHES.find((m) => m.id === id);

  if (!match) notFound();

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">{match.title}</h1>
      <p data-numeric className="text-ink-muted mt-2 font-mono text-sm">
        {match.id} · {match.durationLabel} · {match.fps}fps
      </p>

      <div className="rounded-card border-border bg-surface mt-8 max-w-2xl border p-5">
        <p className="text-base">The analysis view is not built yet.</p>
        <p className="text-ink-muted mt-2 text-sm">
          Next up: the demo JSON fixtures, then the video player and shot
          timeline — the core loop where clicking a shot seeks the video.
        </p>
        <Link
          href="/"
          className="bg-brand text-on-brand hover:bg-brand-hover mt-4 inline-block rounded px-4 py-2 text-sm font-medium transition-colors duration-150 ease-out"
        >
          Back to demos
        </Link>
      </div>
    </div>
  );
}
