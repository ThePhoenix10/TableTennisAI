import { DashboardGlimpse } from "@/components/dashboard-glimpse";
import { Hero } from "@/components/hero";
import { WhatThisMeasures } from "@/components/what-this-measures";
import { DEMO_MATCHES } from "@/lib/constants";
import { readDemoStats } from "@/lib/demo-stats";
import Link from "next/link";

export default async function HomePage() {
  const real = DEMO_MATCHES.find((m) => !m.isSynthetic);
  const stats = real ? await readDemoStats(real.id) : null;

  return (
    <>
      <Hero />

      {/* Feature cards strip */}
      <section className="border-b border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: "⏱",
                title: "Shot timing",
                desc: "Every contact detected to within a few hundredths of a second.",
              },
              {
                icon: "🎯",
                title: "Player attribution",
                desc: "99.4% accuracy identifying which player hit each shot.",
              },
              {
                icon: "📐",
                title: "13 measurements",
                desc: "Wrist speed, stance width, swing arc and more — from body alone.",
              },
              {
                icon: "🏓",
                title: "Stroke classification",
                desc: "Serve, attack, control or defence — with calibrated confidence.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl gradient-brand text-lg shadow-sm">
                  {f.icon}
                </div>
                <h3 className="font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Dashboard screenshot */}
      <DashboardGlimpse stats={stats} />

      {/* What it measures accordion */}
      <section className="bg-slate-50 border-t border-slate-100">
        <div className="mx-auto max-w-[1280px] px-4 py-20 sm:px-6">
          <div className="max-w-3xl mx-auto">
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-bold text-slate-900">Honest about its limits</h2>
              <p className="mt-2 text-slate-500">A measurement you cannot trust is worse than one you do not have.</p>
            </div>
            <WhatThisMeasures defaultOpen />
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="gradient-brand">
        <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 text-center">
          <h2 className="text-2xl font-bold text-white">Ready to analyse your match?</h2>
          <p className="mt-3 text-orange-100 text-sm max-w-md mx-auto">
            Upload a side-on video and get a full shot-by-shot breakdown in minutes.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/analysis/game_1/"
              className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-orange-600 shadow-lg hover:bg-orange-50 transition-colors"
            >
              Try the demo first
            </Link>
            <Link
              href="/signup/"
              className="rounded-xl border border-white/30 bg-white/10 px-6 py-3 text-sm font-bold text-white hover:bg-white/20 transition-colors backdrop-blur-sm"
            >
              Create free account
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}