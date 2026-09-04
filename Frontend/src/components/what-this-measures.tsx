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
  return (
    <div>
      <h3 className="text-ink-muted text-sm font-semibold tracking-wide uppercase">
        {title}
      </h3>
      <ul className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-sm">
        {items.map((item) => (
          <li
            key={item}
            className={[
              "rounded border px-2 py-1",
              tone === "can"
                ? "border-border bg-bg"
                : tone === "cannot"
                  ? "border-border bg-bg text-ink-muted decoration-ink-subtle line-through"
                  : "border-border bg-bg",
            ].join(" ")}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "What this measures" — spec §8.
 *
 * Persistent and collapsible, reachable from every screen. Users assume a
 * video tool sees the ball; it does not, and saying so up front prevents
 * disappointment later. Built on <details> so it works without JavaScript
 * and is keyboard-operable for free.
 */
export function WhatThisMeasures({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-card border-border bg-surface border"
    >
      <summary className="rounded-card flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-base font-semibold">
        What PongAI measures
        <span
          aria-hidden
          className="text-ink-muted text-sm font-normal transition-[rotate] duration-150 ease-out group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <div className="border-border grid gap-6 border-t px-5 py-5">
        <List title="Can measure" items={CAN_MEASURE} tone="can" />
        <List title="Cannot measure" items={CANNOT_MEASURE} tone="cannot" />
        <List title="Works best with" items={WORKS_BEST_WITH} tone="neutral" />

        <p className="text-ink-muted max-w-prose text-sm">
          PongAI works from body pose only — it never tracks the ball. That is
          why spin, racket angle and ball placement are absent rather than
          estimated.
        </p>
      </div>
    </details>
  );
}
