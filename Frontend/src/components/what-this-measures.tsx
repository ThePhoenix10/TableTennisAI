import { CAN_MEASURE, CANNOT_MEASURE, WORKS_BEST_WITH } from "@/lib/constants";

function List({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly string[];
  tone: "can" | "cannot" | "neutral";
}) {
  const dotColor =
    tone === "can" ? "bg-green-500" : tone === "cannot" ? "bg-red-400" : "bg-orange-500";

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-block size-1.5 rounded-full ${dotColor}`} />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          {title}
        </h3>
      </div>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item}
            className={[
              "rounded-lg border px-2.5 py-1 text-xs font-medium",
              tone === "can"
                ? "border-green-200 bg-green-50 text-green-700"
                : tone === "cannot"
                  ? "border-slate-200 bg-slate-50 text-slate-400 line-through decoration-slate-300"
                  : "border-orange-200 bg-orange-50 text-orange-700",
            ].join(" ")}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WhatThisMeasures({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors">
        <span className="flex items-center gap-2.5">
          <span className="flex size-6 items-center justify-center rounded-lg gradient-brand text-xs text-white">◎</span>
          What PongAI measures
        </span>
        <span aria-hidden className="text-slate-400 text-xs transition-[rotate] duration-200 ease-out group-open:rotate-180">▾</span>
      </summary>

      <div className="border-t border-slate-100 px-6 py-6 grid gap-6">
        <List title="Can measure" items={CAN_MEASURE} tone="can" />
        <List title="Cannot measure" items={CANNOT_MEASURE} tone="cannot" />
        <List title="Works best with" items={WORKS_BEST_WITH} tone="neutral" />
        <p className="text-xs leading-relaxed text-slate-400 border-t border-slate-100 pt-4">
          PongAI works from body pose only — it never tracks the ball. That is
          why spin, racket angle and ball placement are absent rather than estimated.
        </p>
      </div>
    </details>
  );
}