import type { Metadata } from "next";
import Link from "next/link";
import {
  MatchSummary,
  RalliesOnlyToggle,
  RallyStrip,
  ShotRecord,
  ShotStrip,
} from "@/components/how-visuals";
import { readHowItWorks } from "@/lib/how-it-works-data";

export const metadata: Metadata = { title: "How it works" };

const LIMITS = [
  {
    h: "Spin, racket angle, ball placement",
    p: "None of these are in the body. PongAI never sees the ball, so it cannot tell you where you put it or what you did to it.",
  },
  {
    h: "Swing speed below 60fps",
    p: "The wrist-speed peak is about 33ms wide. At 30fps it is sampled once and under-measured by roughly half, so those four metrics are withheld rather than estimated.",
  },
  {
    h: "Two of the four stroke labels",
    p: "Control is right about 80% of the time and defence about 56%. They are shown and counted, but no conclusion is drawn from them.",
  },
  {
    h: "Footage that is not side-on",
    p: "One table, both players in frame, camera steady and level with the table. A moving camera or an angled view breaks the geometry the whole thing rests on.",
  },
];

export default async function Page() {
  const data = await readHowItWorks();

  const steps = [
    {
      title: "You upload a match",
      body: "A side-on video, up to 100 MB and five minutes. The file is measured in your browser first, so a clip that cannot work is caught before it is uploaded rather than after.",
      visual: (
        /* eslint-disable-next-line @next/next/no-img-element --
           a fixed-size still; next/image would add a loader for no gain. */
        <img
          src="/hero/rally-poster.jpg"
          alt="A side-on view of a table tennis match, both players and the whole table in frame."
          width={1280}
          height={720}
          className="rounded-card border-border w-full border"
        />
      ),
    },
    {
      title: "The rallies are found",
      body: "Most of a recording is people picking up the ball. A detector samples the video and keeps only the stretches where both players are present and moving, so nothing downstream is spent on the gaps. The player then offers a Show only rallies switch, which skips straight from one point to the next.",
      visual: data && (
        <div className="space-y-4">
          <RallyStrip
            rallies={data.rallies}
            durationS={data.durationS}
            activeS={data.activeS}
          />
          <RalliesOnlyToggle
            rallies={data.rallies}
            activeS={data.activeS}
            durationS={data.durationS}
          />
        </div>
      ),
      aside: data && (
        <>
          In this match, <strong>{Math.round(data.activeS)} seconds</strong> of
          play inside a {Math.round(data.durationS / 60)}-minute recording.
        </>
      ),
    },
    {
      title: "Both players are tracked",
      body: "A pose model follows seventeen body joints for each player, frame by frame. It works from a tight crop around each of them rather than the whole frame, which is substantially more accurate.",
      visual: (
        /* eslint-disable-next-line @next/next/no-img-element --
           a fixed-size still; next/image would add a loader for no gain. */
        <img
          src="/how/player-tracked.jpg"
          alt="One player mid-stroke with a skeleton drawn over them, joints marked at the shoulders, elbows, wrists, hips, knees and ankles."
          width={560}
          height={720}
          className="rounded-card border-border mx-auto w-full max-w-[18rem] border"
        />
      ),
    },
    {
      title: "Shots are detected and attributed",
      body: "A temporal model reads the motion and marks the moment of contact to within a few hundredths of a second, then decides which player played it. Attribution is right 99.4% of the time.",
      visual: data && (
        <ShotStrip shots={data.shots} durationS={data.durationS} />
      ),
      aside: data && (
        <>
          <strong>{data.shots.length} shots</strong> across{" "}
          {data.rallies.length} rallies, each placed on the side of whoever hit
          it.
        </>
      ),
    },
    {
      title: "Strokes are classified and measured",
      body: "Each shot gets one of four labels, serve, attack, control or defence, with a calibrated confidence, plus thirteen measurements taken from the body alone.",
      visual: data?.exemplar && (
        <ShotRecord shot={data.exemplar} fps={data.fps} />
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
        <p className="text-ink-muted mt-4 text-lg">
          PongAI reads a match from body movement alone. It never tracks the
          ball, and it needs nothing but a video.
        </p>
        <p className="text-ink-subtle mt-2 text-sm">
          Everything below is drawn from the same analysed match you can open
          from the home page.
        </p>
      </div>

      {data && <MatchSummary data={data} />}

      <ol className="mt-16 space-y-16">
        {steps.map((s, i) => (
          <li
            key={s.title}
            /* Alternating sides give the eye somewhere to go on a long page,
               and keep the visual next to the words that explain it. */
            className="grid items-center gap-6 lg:grid-cols-2 lg:gap-12"
          >
            <div className={i % 2 === 1 ? "lg:order-2" : undefined}>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="bg-brand text-on-brand flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                >
                  {i + 1}
                </span>
                <h2 className="text-lg font-semibold">{s.title}</h2>
              </div>
              <p className="text-ink-muted mt-3">{s.body}</p>
              {s.aside && (
                <p className="border-brand text-ink-muted mt-4 border-l-2 pl-3 text-sm">
                  {s.aside}
                </p>
              )}
            </div>
            <div className={i % 2 === 1 ? "lg:order-1" : undefined}>
              {s.visual}
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-20 max-w-3xl">
        <h2 className="text-lg font-semibold">What it cannot tell you</h2>
        <p className="text-ink-muted mt-2 text-sm">
          Stated plainly, because a measurement you cannot trust is worse than
          one you do not have.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {LIMITS.map((l) => (
            <div
              key={l.h}
              className="rounded-card border-border bg-surface border p-4"
            >
              <h3 className="text-sm font-semibold">{l.h}</h3>
              <p className="text-ink-muted mt-1 text-sm">{l.p}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-14 text-sm">
        <Link href="/analysis/game_1/" className="text-brand-text underline">
          Open the full analysis
        </Link>{" "}
        to see all of this on the real match. It loads instantly, and nothing is
        uploaded.
      </p>
    </div>
  );
}
