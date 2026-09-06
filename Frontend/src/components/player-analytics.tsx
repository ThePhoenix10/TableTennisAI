"use client";

import { useMemo, useState } from "react";
import {
  KINEMATIC_LABELS,
  MIN_SHOTS_FOR_CONSISTENCY,
  VELOCITY_GATE_MESSAGE,
  consistency,
  formatPercent,
  kinematicStats,
  reliableLabelCount,
  shotMix,
  summarise,
} from "@/lib/analysis";
import {
  POSITION_KINEMATICS,
  SHOT_CLASSES,
  SHOT_CLASS_META,
  VELOCITY_KINEMATICS,
  isVelocityReliable,
} from "@/lib/constants";
import { variabilityLabel } from "@/lib/findings";
import type { KinematicKey, Shot, ShotClass } from "@/lib/types";

interface Props {
  label: string;
  shots: Shot[];
  sourceFps: number;
  onFilterClass: (shotClass: ShotClass | null) => void;
  activeClassFilter: ShotClass | null;
  onFilterPlayer: () => void;
  playerFiltered: boolean;
}

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

/** Mean ± spread, never a bare mean — a lone average hides the story. */
function StatRow({
  label,
  stat,
  unit,
  dp,
}: {
  label: string;
  stat: { mean: number; sd: number } | null;
  unit: string;
  dp: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-xs">
      <span className="text-ink-muted">{label}</span>
      <span data-numeric className="font-mono">
        {stat ? (
          <>
            {stat.mean.toFixed(dp)}
            <span className="text-ink-subtle"> ± {stat.sd.toFixed(dp)}</span>
            <span className="text-ink-subtle"> {unit}</span>
          </>
        ) : (
          <span className="text-ink-subtle">—</span>
        )}
      </span>
    </div>
  );
}

export function PlayerAnalytics({
  label,
  shots,
  sourceFps,
  onFilterClass,
  activeClassFilter,
  onFilterPlayer,
  playerFiltered,
}: Props) {
  // Averaging a serve and a block together produces a number that describes
  // neither, so technique blocks are per-class (addendum §3.3).
  const [techniqueClass, setTechniqueClass] = useState<ShotClass>("attack");

  const mix = useMemo(() => shotMix(shots), [shots]);
  const reliable = useMemo(() => reliableLabelCount(shots), [shots]);
  const classShots = useMemo(
    () => shots.filter((s) => s.shot_class === techniqueClass),
    [shots, techniqueClass],
  );

  const positionStats = useMemo(
    () => kinematicStats(classShots, POSITION_KINEMATICS),
    [classShots],
  );
  const velocityStats = useMemo(
    () => kinematicStats(classShots, VELOCITY_KINEMATICS),
    [classShots],
  );
  const consistencyRows = useMemo(() => consistency(classShots), [classShots]);
  const tableDistance = useMemo(
    () => summarise(shots.map((s) => s.table_distance)),
    [shots],
  );

  const velocityAvailable = isVelocityReliable(sourceFps);
  const maxCount = Math.max(...mix.map((m) => m.count), 1);

  return (
    <div className="rounded-card border-border bg-surface flex flex-col gap-4 border p-4">
      <header className="flex items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={onFilterPlayer}
          aria-pressed={playerFiltered}
          className={[
            "rounded text-sm font-semibold transition-colors duration-150 ease-out",
            playerFiltered ? "text-brand-text underline" : "hover:underline",
          ].join(" ")}
        >
          {label}
        </button>
        <span data-numeric className="text-ink-muted font-mono text-xs">
          {shots.length} shots
        </span>
      </header>

      {/* 3.1 Shot mix */}
      <Block title="Shot mix">
        <ul className="flex flex-col gap-1">
          {mix.map((row) => {
            const meta = SHOT_CLASS_META[row.shotClass];
            const isActive = activeClassFilter === row.shotClass;
            return (
              <li key={row.shotClass}>
                <button
                  type="button"
                  onClick={() => onFilterClass(isActive ? null : row.shotClass)}
                  aria-pressed={isActive}
                  className="group flex w-full items-center gap-2 rounded py-0.5 text-left text-xs"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: meta.colorVar }}
                  >
                    {meta.letter}
                  </span>
                  <span className={isActive ? "font-semibold" : ""}>
                    {meta.label}
                  </span>
                  <span
                    data-numeric
                    className="text-ink-muted ml-auto font-mono"
                  >
                    {row.count}
                  </span>
                  <span className="bg-bg relative h-3 w-20 shrink-0 overflow-hidden rounded-sm">
                    <span
                      className={[
                        "absolute inset-y-0 left-0",
                        meta.reliable ? "" : "hatch-uncertain",
                      ].join(" ")}
                      style={{
                        width: `${(row.count / maxCount) * 100}%`,
                        backgroundColor: meta.colorVar,
                        opacity: meta.reliable ? 1 : 0.55,
                      }}
                    />
                  </span>
                  <span
                    data-numeric
                    className="text-ink-muted w-9 shrink-0 text-right font-mono"
                  >
                    {formatPercent(row.share)}
                  </span>
                </button>
                {!meta.reliable && row.count > 0 && (
                  <span className="text-ink-subtle ml-6 text-[11px]">
                    uncertain — {formatPercent(meta.precision)} precise
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <p className="text-ink-muted mt-3 text-xs">
          Reliable labels:{" "}
          <span data-numeric className="font-mono">
            {reliable.reliable} of {reliable.total} (
            {formatPercent(reliable.share)})
          </span>
        </p>
      </Block>

      {/* 3.2 Court position */}
      <Block
        title="Court position"
        note="Distance from table, in torso-lengths. Reliable at any frame rate."
      >
        <StatRow
          label="Distance from table"
          stat={tableDistance}
          unit="torso"
          dp={2}
        />
        {tableDistance && (
          <p className="text-ink-subtle mt-1 text-xs">
            {tableDistance.mean < 1
              ? "Stands close — blocking and pushing range."
              : tableDistance.mean > 1.8
                ? "Backs off the table — looping and chopping range."
                : "Mid-distance play."}
          </p>
        )}
      </Block>

      {/* Class selector shared by the technique and consistency blocks. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-ink-muted text-xs">Technique for</span>
        {SHOT_CLASSES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setTechniqueClass(c)}
            aria-pressed={techniqueClass === c}
            className={[
              "rounded border px-1.5 py-0.5 text-xs transition-colors duration-150 ease-out",
              techniqueClass === c
                ? "border-brand bg-brand text-on-brand"
                : "border-border text-ink-muted",
            ].join(" ")}
          >
            {SHOT_CLASS_META[c].label}
          </button>
        ))}
      </div>

      {/* 3.3 Technique — position group */}
      <Block
        title="Technique — position"
        note={`${classShots.length} ${SHOT_CLASS_META[techniqueClass].label.toLowerCase()} shots · mean ± spread`}
      >
        {classShots.length === 0 ? (
          <p className="text-ink-subtle text-xs">No shots of this class.</p>
        ) : (
          POSITION_KINEMATICS.map((key: KinematicKey) => (
            <StatRow
              key={key}
              label={KINEMATIC_LABELS[key].label}
              stat={positionStats.get(key) ?? null}
              unit={KINEMATIC_LABELS[key].unit}
              dp={KINEMATIC_LABELS[key].dp}
            />
          ))
        )}
      </Block>

      {/* 3.4 Technique — velocity group, gated on source fps */}
      <Block title="Technique — swing speed">
        {velocityAvailable ? (
          classShots.length === 0 ? (
            <p className="text-ink-subtle text-xs">No shots of this class.</p>
          ) : (
            VELOCITY_KINEMATICS.map((key: KinematicKey) => (
              <StatRow
                key={key}
                label={KINEMATIC_LABELS[key].label}
                stat={velocityStats.get(key) ?? null}
                unit={KINEMATIC_LABELS[key].unit}
                dp={KINEMATIC_LABELS[key].dp}
              />
            ))
          )
        ) : (
          /* Absent, not greyed — spec §7.4. */
          <p className="text-ink-muted border-border bg-bg rounded border p-3 text-xs">
            {VELOCITY_GATE_MESSAGE(sourceFps)}
          </p>
        )}
      </Block>

      {/* 3.5 Consistency — the block that needs no external reference */}
      <Block
        title="Consistency"
        note="Variation across this player's own shots, ranked least consistent first. Lower is steadier."
      >
        {consistencyRows.length === 0 ? (
          <p className="text-ink-subtle text-xs">
            Not enough shots — needs at least {MIN_SHOTS_FOR_CONSISTENCY} of
            this class.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {consistencyRows.map((row) => {
              const { label, typicalRange } = KINEMATIC_LABELS[row.key];
              // A percentage only where the mean is a stable reference;
              // otherwise the spread in the metric's own units.
              const relative = row.stat.cv ?? row.stat.sd / (typicalRange || 1);
              return (
                <li key={row.key} className="flex items-center gap-2 text-xs">
                  <span className="text-ink-muted w-32 shrink-0 truncate">
                    {label}
                  </span>
                  <span
                    data-numeric
                    className="w-20 shrink-0 text-right font-mono"
                  >
                    {/* One source of truth for pct-vs-absolute phrasing. */}
                    {variabilityLabel(row.key, row.stat)}
                  </span>
                  <span className="bg-bg relative h-2 flex-1 overflow-hidden rounded-sm">
                    <span
                      className="bg-brand absolute inset-y-0 left-0"
                      style={{ width: `${Math.min(100, relative * 220)}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-ink-subtle mt-2 text-xs">
          Compared against this player only — no professional reference is
          implied.
        </p>
      </Block>
    </div>
  );
}
