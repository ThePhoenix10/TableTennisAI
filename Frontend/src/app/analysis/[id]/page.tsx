import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnalysisScreen } from "@/components/analysis-screen";
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
  const match = DEMO_MATCHES.find((m) => m.id === id);
  return { title: match ? `${match.title} · ${id}` : id };
}

export default async function AnalysisPage({
  params,
}: PageProps<"/analysis/[id]">) {
  const { id } = await params;
  if (!DEMO_MATCHES.some((m) => m.id === id)) notFound();

  // Keyed so switching matches remounts with clean state rather than
  // resetting it inside an effect.
  return <AnalysisScreen key={id} id={id} />;
}
