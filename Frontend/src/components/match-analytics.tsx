"use client";

import { useMemo } from "react";
import {
  analysisQuality,
  exchangeMatrix,
  formatPercent,
  matchTempo,
  rallyLengthHistogram,
  summarise,
} from "@/lib/analysis";
import type { Rally } from "@/lib/analysis";
import { SHOT_CLASSES, SHOT_CLASS_META } from "@/lib/constants";
import type { AnalysisFile } from "@/lib/types";

function Block({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <section className="border-border border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {note && <p className="text-ink-muted mt-0.5 text-xs">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div data-numeric className="font-mono text-lg">
        {value}
      </div>
      <div className="text-ink-muted text-xs">{label}</div>
    </div>
  );
}

/** A bare-bones bar chart. Recharts is overkill for a fixed-bucket histogram. */
function Bars({
  data,
  ariaLabel,
}: {
  data: { label: string; count: number }[];
  ariaLabel: string;
}) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const PLOT_PX = 80;
  return (
    <div role="img" aria-label={ariaLabel} className="flex items-end gap-1">
      {data.map((d) => (
        <div
          key={d.label}
          className="flex min-w-0 flex-1 flex-col items-center gap-1"
        >
          {/* Bars are sized in px against a fixed plot height: a percentage
              would resolve against an auto-height flex parent and collapse. */}
          <div
            className="bg-brand w-full rounded-t-sm"
            style={{
              height: Math.max(d.count ? 2 : 0, (d.count / max) * PLOT_PX),
            }}
            title={`${d.label}: ${d.count}`}
          />
          <span data-numeric className="text-ink-subtle font-mono text-[10px]">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MatchAnalytics({
  file,
  rallies,
}: {
  file: AnalysisFile;
  rallies: Rally[];
}) {
  const lengths = useMemo(() => rallies.map((r) => r.length), [rallies]);
  const lengthStat = useMemo(() => summarise(lengths), [lengths]);
  const longest = useMemo(() => Math.max(...lengths, 0), [lengths]);
  const histogram = useMemo(() => rallyLengthHistogram(rallies), [rallies]);
  const tempo = useMemo(
    () => matchTempo(file.shots, file.duration_s),
    [file.shots, file.duration_s],
  );
  const exchange = useMemo(() => exchangeMatrix(rallies), [rallies]);
  const quality = useMemo(() => analysisQuality(file), [file]);

  const serves = useMemo(() => {
    const left = rallies.filter((r) => r.server === "left").length;
    return { left, right: rallies.length - left };
  }, [rallies]);

  return (
    <div className="rounded-card border-border bg-surface flex flex-col gap-4 border p-4">
      <h2 className="text-sm font-semibold">Match analytics</h2>

      {/* 4.1 Rally structure */}
      <Block title="Rally structure">
        <div className="flex flex-wrap gap-6">
          <Figure value={String(rallies.length)} label="rallies" />
          <Figure
            value={lengthStat ? lengthStat.mean.toFixed(1) : "—"}
            label="mean shots"
          />
          <Figure value={String(longest)} label="longest" />
        </div>
        <div className="mt-3">
          <Bars data={histogram} ariaLabel="Rally length distribution" />
          <p className="text-ink-subtle mt-1 text-xs">shots per rally</p>
        </div>
      </Block>

      {/* 4.2 Match tempo */}
      <Block title="Match tempo" note="Shots per minute across the match.">
        <Bars
          data={tempo.map((t) => ({ label: String(t.minute), count: t.shots }))}
          ariaLabel="Shots per minute across the match"
        />
        <p className="text-ink-subtle mt-1 text-xs">minute</p>
      </Block>

      {/* 4.3 Exchange pattern */}
      <Block
        title="Exchange pattern"
        note="Given one player played X, what the opponent played next."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">
              Shot class transitions between players
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="text-ink-muted p-1 text-left font-normal"
                >
                  played →
                </th>
                {SHOT_CLASSES.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className="text-ink-muted p-1 text-right font-normal"
                  >
                    {SHOT_CLASS_META[c].letter}
                    {!SHOT_CLASS_META[c].reliable && (
                      <span aria-label="uncertain class"> *</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SHOT_CLASSES.map((from) => (
                <tr key={from} className="border-border border-t">
                  <th
                    scope="row"
                    className="p-1 text-left font-normal whitespace-nowrap"
                  >
                    {SHOT_CLASS_META[from].label}
                    {!SHOT_CLASS_META[from].reliable && (
                      <span aria-label="uncertain class"> *</span>
                    )}
                  </th>
                  {SHOT_CLASSES.map((to) => {
                    const cell = exchange.find(
                      (c) => c.from === from && c.to === to,
                    );
                    const uncertain =
                      !SHOT_CLASS_META[from].reliable ||
                      !SHOT_CLASS_META[to].reliable;
                    return (
                      <td
                        key={to}
                        data-numeric
                        className={[
                          "p-1 text-right font-mono",
                          uncertain ? "text-ink-subtle" : "",
                        ].join(" ")}
                      >
                        {cell && cell.count > 0
                          ? formatPercent(cell.share)
                          : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-ink-subtle mt-2 text-xs">
          * involves a class PongAI labels unreliably — read those rows and
          columns with caution.
        </p>
      </Block>

      {/* 4.4 Serve distribution */}
      <Block title="Serves" note="The first shot of every rally is a serve.">
        <div className="flex gap-6">
          <Figure value={String(serves.left)} label="left player" />
          <Figure value={String(serves.right)} label="right player" />
        </div>
        <p className="text-ink-subtle mt-2 text-xs">
          Points won and lost are not shown — the pipeline does not predict
          rally outcomes.
        </p>
      </Block>

      {/* 4.5 Analysis quality */}
      <Block
        title="Analysis quality"
        note="How much to trust everything above."
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-ink-muted">Pose confidence</dt>
            <dd data-numeric className="font-mono">
              {formatPercent(quality.meanPoseConfidence)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Player detected</dt>
            <dd data-numeric className="font-mono">
              {formatPercent(quality.meanDetectionRate)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Shots abstained</dt>
            <dd data-numeric className="font-mono">
              {formatPercent(quality.abstainedShare)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Source</dt>
            <dd data-numeric className="font-mono">
              {quality.sourceFps}fps
              {!quality.velocityAvailable && (
                <span className="text-ink-subtle"> · no speed</span>
              )}
            </dd>
          </div>
        </dl>
      </Block>
    </div>
  );
}
