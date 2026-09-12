import { DashboardGlimpse } from "@/components/dashboard-glimpse";
import { Hero } from "@/components/hero";
import { WhatThisMeasures } from "@/components/what-this-measures";
import { DEMO_MATCHES } from "@/lib/constants";
import { readDemoStats } from "@/lib/demo-stats";

export default async function HomePage() {
  // The one genuinely analysed match. Synthetic fixtures stay in the registry
  // and remain reachable at /analysis/{id} for development — they are the only
  // data that exercises findings, evidence mode and the 30fps velocity gate —
  // but they are never presented as results.
  const real = DEMO_MATCHES.find((m) => !m.isSynthetic);
  const stats = real ? await readDemoStats(real.id) : null;

  return (
    <>
      <Hero />
      <DashboardGlimpse stats={stats} />

      <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
        <section className="mt-16 max-w-3xl">
          <WhatThisMeasures />
        </section>
      </div>
    </>
  );
}
