import { CAN_MEASURE, CANNOT_MEASURE, WORKS_BEST_WITH } from "@/lib/constants";

function Chip({ label, tone }: { label: string; tone: "can" | "cannot" | "neutral" }) {
  const styles = {
    can: "border-green-200 bg-green-50 text-green-700",
    cannot: "border-slate-200 bg-slate-50 text-slate-400 line-through decoration-slate-300",
    neutral: "border-orange-200 bg-orange-50 text-orange-700",
  };
  return (
    <li className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${styles[tone]}`}>
      {label}
    </li>
  );
}

export function WhatThisMeasures({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 hover:bg-slate-50 transition-colors">
        <span className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg gradient-brand text-white text-sm shadow-sm">
            ◎
          </span>
          <span className="text-sm font-semibold text-slate-800">What PongAI measures</span>
        </span>
        <span aria-hidden className="text-slate-400 text-xs transition-[rotate] duration-200 ease-out group-open:rotate-180">▾</span>
      </summary>

      <div className="border-t border-slate-100 px-6 py-6 space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block size-2 rounded-full bg-green-500" />
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Can measure</h3>
          </div>
          <ul className="flex flex-wrap gap-2">
            {CAN_MEASURE.map((item) => <Chip key={item} label={item} tone="can" />)}
          </ul>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block size-2 rounded-full bg-red-400" />
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Cannot measure</h3>
          </div>
          <ul className="flex flex-wrap gap-2">
            {CANNOT_MEASURE.map((item) => <Chip key={item} label={item} tone="cannot" />)}
          </ul>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block size-2 rounded-full bg-orange-400" />
            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">Works best with</h3>
          </div>
          <ul className="flex flex-wrap gap-2">
            {WORKS_BEST_WITH.map((item) => <Chip key={item} label={item} tone="neutral" />)}
          </ul>
        </div>

        <p className="text-xs leading-relaxed text-slate-400 border-t border-slate-100 pt-4">
          PongAI works from body pose only — it never tracks the ball. That is why spin, racket angle and ball placement are absent rather than estimated.
        </p>
      </div>
    </details>
  );
}