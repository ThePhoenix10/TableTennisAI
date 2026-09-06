"use client";

import { useState } from "react";
import { emptyFindingsMessage, type Finding } from "@/lib/findings";
import type { Player, Shot } from "@/lib/types";

/**
 * "What to work on" — revision 2 §3.
 *
 * The primary output of the screen. A coach is not reviewing 400 shots; they
 * are looking for the one or two things worth a session. Everything else lives
 * behind the Full analysis disclosure.
 */

function FindingCard({
  finding,
  onShowMe,
  active,
}: {
  finding: Finding;
  onShowMe: (f: Finding) => void;
  active: boolean;
}) {
  const good = finding.severity === "good";
  return (
    <li
      className={[
        "rounded-card bg-surface border border-l-4 p-4",
        active ? "border-ink" : "border-border",
      ].join(" ")}
      style={{
        borderLeftColor: good ? "var(--color-control)" : "var(--color-brand)",
      }}
    >
      <div className="flex items-start gap-2">
        {/* The glyph carries the meaning; colour only reinforces it. */}
        <span aria-hidden className={good ? "text-control" : "text-brand-text"}>
          {good ? "✓" : "⚠"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">
            <span className="sr-only">
              {good ? "Strength: " : "Needs work: "}
            </span>
            {finding.headline}
          </p>
          {finding.detail && (
            <p className="text-ink-muted mt-1.5 text-sm">{finding.detail}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {/* Sample size is always visible: it is how a coach judges
                whether to believe the finding. */}
            <span data-numeric className="text-ink-muted font-mono text-xs">
              Based on {finding.evidence.sampleSize} {finding.shotClass}s
            </span>
            <button
              type="button"
              onClick={() => onShowMe(finding)}
              aria-pressed={active}
              className="bg-brand text-on-brand hover:bg-brand-hover rounded px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-out"
            >
              {active ? "showing" : "show me →"}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function Column({
  player,
  label,
  findings,
  reliable,
  shots,
  onShowMe,
  activeId,
}: {
  player: Player;
  label: string;
  findings: Finding[];
  reliable: number;
  shots: Shot[];
  onShowMe: (f: Finding) => void;
  activeId: string | null;
}) {
  return (
    <section aria-labelledby={`findings-${player}`}>
      <h3
        id={`findings-${player}`}
        className="text-ink-muted mb-2 text-sm font-semibold tracking-wide uppercase"
      >
        {label} ·{" "}
        <span data-numeric className="font-mono normal-case">
          {reliable} reliable
        </span>
      </h3>

      {findings.length === 0 ? (
        <p className="rounded-card border-border bg-surface text-ink-muted border p-4 text-sm">
          {emptyFindingsMessage(shots, player, reliable)}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {findings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              onShowMe={onShowMe}
              active={activeId === f.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function FindingsSection({
  left,
  right,
  leftReliable,
  rightReliable,
  shots,
  onShowMe,
  activeId,
}: {
  left: Finding[];
  right: Finding[];
  leftReliable: number;
  rightReliable: number;
  shots: Shot[];
  onShowMe: (f: Finding) => void;
  activeId: string | null;
}) {
  const [tab, setTab] = useState<Player>("left");

  return (
    <section aria-labelledby="what-to-work-on" id="findings">
      <h2 id="what-to-work-on" className="text-lg font-semibold">
        What to work on
      </h2>

      {/* Tabs on mobile, both columns on desktop. */}
      <div
        role="tablist"
        aria-label="Player"
        className="mt-3 flex gap-1 lg:hidden"
      >
        {(["left", "right"] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={tab === p}
            onClick={() => setTab(p)}
            className={[
              "rounded border px-3 py-1.5 text-sm transition-colors duration-150 ease-out",
              tab === p
                ? "border-brand bg-brand text-on-brand"
                : "border-border text-ink-muted",
            ].join(" ")}
          >
            {p === "left" ? "Left player" : "Right player"}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-6 lg:grid-cols-2">
        <div className={tab === "left" ? "" : "hidden lg:block"}>
          <Column
            player="left"
            label="Left"
            findings={left}
            reliable={leftReliable}
            shots={shots}
            onShowMe={onShowMe}
            activeId={activeId}
          />
        </div>
        <div className={tab === "right" ? "" : "hidden lg:block"}>
          <Column
            player="right"
            label="Right"
            findings={right}
            reliable={rightReliable}
            shots={shots}
            onShowMe={onShowMe}
            activeId={activeId}
          />
        </div>
      </div>
    </section>
  );
}
