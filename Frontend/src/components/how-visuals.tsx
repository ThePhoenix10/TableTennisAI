import { SHOT_CLASS_META } from "@/lib/constants";
import type { HowItWorksData, RallySpan } from "@/lib/how-it-works-data";
import type { Shot } from "@/lib/types";

/**
 * Illustrations for How it works, drawn from the real match.
 *
 * Inline SVG rather than images: these are a handful of rectangles over data
 * the page already has, they stay sharp at any size, and they cannot fall out
 * of step with the export the way a screenshot would.
 */

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

/** Where the play actually is. Dead time is most of a recording. */
export function RallyStrip({
  rallies,
  durationS,
  activeS,
}: {
  rallies: RallySpan[];
  durationS: number;
  activeS: number;
}) {
  return (
    <figure>
      <div
        className="bg-bg border-border relative h-14 w-full overflow-hidden rounded border"
        role="img"
        aria-label={`A ${Math.round(durationS)} second recording containing ${rallies.length} rallies, about ${Math.round(activeS)} seconds of play in total.`}
      >
        {rallies.map((r, i) => (
          <div
            key={i}
            className="bg-brand absolute top-0 bottom-0"
            style={{
              left: pct(r.start, durationS),
              // A rally can be under a second; keep it visible.
              width: `max(3px, ${(((r.end - r.start) / durationS) * 100).toFixed(3)}%)`,
            }}
          />
        ))}
      </div>
      <figcaption
        data-numeric
        className="text-ink-muted mt-2 flex justify-between font-mono text-xs"
      >
        <span>0:00</span>
        <span className="text-ink-subtle font-sans">
          orange = a rally in progress
        </span>
        <span>
          {Math.floor(durationS / 60)}:
          {String(Math.round(durationS % 60)).padStart(2, "0")}
        </span>
      </figcaption>
    </figure>
  );
}

/** Every shot, on the side of the player who hit it. */
export function ShotStrip({
  shots,
  durationS,
}: {
  shots: Shot[];
  durationS: number;
}) {
  return (
    <figure>
      <div
        className="bg-bg border-border relative h-24 w-full rounded border"
        role="img"
        aria-label={`${shots.length} detected shots across the match, the left player's above the centre line and the right player's below.`}
      >
        <div className="border-border absolute inset-x-0 top-1/2 border-t" />
        {shots.map((s, i) => {
          const meta = SHOT_CLASS_META[s.shot_class];
          const up = s.player === "left";
          return (
            <div
              key={i}
              className="absolute w-[3px] rounded-full"
              style={{
                left: pct(s.timestamp_s, durationS),
                height: 26,
                top: up ? "calc(50% - 26px)" : "50%",
                backgroundColor: meta.colorVar,
                // Unreliable labels are drawn faintly, the same rule the
                // analysis screen follows.
                opacity: s.abstain ? 0.35 : 1,
              }}
            />
          );
        })}
      </div>
      <figcaption className="text-ink-muted mt-2 text-xs">
        Left player above the line, right below. Faint marks are labels PongAI
        is not confident enough to act on.
      </figcaption>
    </figure>
  );
}

/** One real shot record, as the pipeline emitted it. */
export function ShotRecord({ shot, fps }: { shot: Shot; fps: number }) {
  const meta = SHOT_CLASS_META[shot.shot_class];
  const rows: [string, string][] = [
    ["Elbow angle", `${Math.round(shot.elbow_angle)}°`],
    ["Trunk rotation", `${Math.round(shot.trunk_rotation)}°`],
    ["Backswing", `${shot.backswing_amplitude.toFixed(2)} torso lengths`],
    [
      "Contact height",
      `${shot.contact_height.toFixed(2)} vs the shoulder line`,
    ],
  ];

  return (
    <figure className="rounded-card border-border bg-surface border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          className="flex size-6 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: meta.colorVar }}
        >
          {meta.letter}
        </span>
        <span className="font-semibold">{meta.label}</span>
        <span className="text-ink-muted text-sm">{shot.technique}</span>
        <span data-numeric className="text-ink-muted ml-auto font-mono text-xs">
          {Math.round(shot.class_confidence * 100)}% confident
        </span>
      </div>

      <dl className="mt-3 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-xs">
            <dt className="text-ink-muted">{k}</dt>
            <dd data-numeric className="font-mono">
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <figcaption className="text-ink-subtle mt-3 text-xs">
        Four of thirteen measurements, from one shot at {fps}fps.
      </figcaption>
    </figure>
  );
}

/** A compact summary of the whole match, for the top of the page. */
export function MatchSummary({ data }: { data: HowItWorksData }) {
  const items: [string, string][] = [
    ["Recording", `${Math.floor(data.durationS / 60)} minutes`],
    ["Rallies found", String(data.rallies.length)],
    ["Shots detected", String(data.shots.length)],
    ["Measurements each", "13"],
  ];
  return (
    <dl className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div
          key={k}
          className="rounded-card border-border bg-surface border p-4"
        >
          <dd data-numeric className="font-mono text-lg font-semibold">
            {v}
          </dd>
          <dt className="text-ink-muted mt-1 text-xs">{k}</dt>
        </div>
      ))}
    </dl>
  );
}

/**
 * The player's "Show only rallies" switch, and what it does to the timeline.
 *
 * The switch is a static replica of the real control in video-stage.tsx, not
 * the control itself: this page has no video to drive, and a dead button the
 * reader can click would be worse than a picture of one.
 */
export function RalliesOnlyToggle({
  rallies,
  activeS,
  durationS,
}: {
  rallies: RallySpan[];
  activeS: number;
  durationS: number;
}) {
  return (
    <figure className="rounded-card border-border bg-surface border p-4">
      <div
        aria-hidden
        className="border-brand bg-brand text-on-brand inline-flex items-center gap-2 rounded border px-2 py-1.5 text-xs leading-none"
      >
        <span className="border-on-brand/40 bg-on-brand/25 flex h-4 w-7 shrink-0 items-center rounded-full border p-0.5">
          <span className="bg-on-brand size-2.5 translate-x-3 rounded-full" />
        </span>
        Show only rallies
      </div>

      <div
        className="bg-bg border-border relative mt-4 flex h-8 w-full overflow-hidden rounded border"
        role="img"
        aria-label={`With the switch on, the same ${rallies.length} rallies play back to back as about ${Math.round(activeS)} seconds instead of ${Math.round(durationS)}.`}
      >
        {rallies.map((r, i) => (
          <div
            key={i}
            className="bg-brand border-surface h-full shrink-0 border-r last:border-r-0"
            style={{ width: pct(r.end - r.start, activeS) }}
          />
        ))}
      </div>

      <figcaption className="text-ink-subtle mt-2 text-xs">
        The gaps are gone. The same {rallies.length} rallies run back to back,
        and the clock and the timeline follow the rallies rather than the file.
      </figcaption>
    </figure>
  );
}
