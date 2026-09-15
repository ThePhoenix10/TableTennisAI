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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/hero/rally-poster.jpg"
          alt="A side-on view of a table tennis match, both players and the whole table in frame."
          width={1280}
          height={720}
          className="rounded-2xl border border-slate-200 w-full shadow-sm"
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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/how/player-tracked.jpg"
          alt="One player mid-stroke with a skeleton drawn over them, joints marked at the shoulders, elbows, wrists, hips, knees and ankles."
          width={560}
          height={720}
          className="rounded-2xl border border-slate-200 mx-auto w-full max-w-[18rem] shadow-sm"
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
          {data.rallies.length} rallies, each placed on the side of whoever hit it.
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
    <div className="bg-slate-50 min-h-screen">
      {/* Page header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-600">
            <span className="size-1.5 rounded-full bg-orange-500 inline-block" />
            Drawn from a real match
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">How it works</h1>
          <p className="mt-4 text-lg text-slate-500 max-w-2xl">
            PongAI reads a match from body movement alone. It never tracks the
            ball, and it needs nothing but a video.
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Everything below is drawn from the same analysed match you can open from the home page.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        {data && <MatchSummary data={data} />}

        {/* Steps */}
        <ol className="mt-16 space-y-20">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16"
            >
              <div className={i % 2 === 1 ? "lg:order-2" : undefined}>
                <div className="flex items-center gap-3 mb-4">
                  <span
                    aria-hidden
                    className="gradient-brand text-white flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-sm glow-brand"
                  >
                    {i + 1}
                  </span>
                  <h2 className="text-lg font-bold text-slate-900">{s.title}</h2>
                </div>
                <p className="text-slate-500 leading-relaxed">{s.body}</p>
                {s.aside && (
                  <p className="border-l-2 border-orange-400 text-slate-500 mt-4 pl-4 text-sm bg-orange-50 py-2 pr-3 rounded-r-lg">
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

        {/* Limits */}
        <section className="mt-24 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-slate-900">What it cannot tell you</h2>
            <p className="mt-2 text-sm text-slate-500">
              Stated plainly, because a measurement you cannot trust is worse than one you do not have.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {LIMITS.map((l) => (
              <div
                key={l.h}
                className="rounded-xl border border-slate-200 bg-slate-50 p-5 hover:border-orange-200 hover:bg-orange-50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-500 text-xs font-bold">✕</span>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">{l.h}</h3>
                    <p className="mt-1 text-sm text-slate-500 leading-relaxed">{l.p}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl gradient-brand p-8 shadow-lg">
          <div>
            <p className="font-bold text-white text-lg">See it on a real match</p>
            <p className="text-orange-100 text-sm mt-1">Loads instantly — nothing is uploaded.</p>
          </div>
          <Link
            href="/analysis/game_1/"
            className="shrink-0 rounded-xl bg-white px-6 py-3 text-sm font-bold text-orange-600 shadow hover:bg-orange-50 transition-colors"
          >
            Open the full analysis →
          </Link>
        </div>
      </div>
    </div>
  );
}