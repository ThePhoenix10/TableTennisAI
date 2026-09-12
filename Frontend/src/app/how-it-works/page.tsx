import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works" };

const STEPS = [
  {
    title: "You upload a match",
    body: "A side-on video, up to 100 MB and five minutes. The file is checked in your browser first, so a clip that cannot work is caught before it is uploaded rather than after.",
  },
  {
    title: "The rallies are found",
    body: "Most of a recording is dead time. A detector samples the video and keeps only the stretches where both players are present and moving, so nothing else is spent on the gaps.",
  },
  {
    title: "Both players are tracked",
    body: "A pose model follows seventeen body joints for each player, frame by frame, working from a tight crop around each of them rather than the whole frame.",
  },
  {
    title: "Shots are detected and attributed",
    body: "A temporal model reads the motion and marks the moment of contact to within a few hundredths of a second, then decides which player played it.",
  },
  {
    title: "Strokes are classified and measured",
    body: "Each shot is labelled — serve, attack, control or defence — and thirteen kinematics are measured from the body alone: backswing, contact height, elbow extension, trunk rotation, stance, and more.",
  },
];

const LIMITS = [
  "Spin, racket angle and ball placement are invisible — they are not in the body.",
  "Swing-speed metrics need 60fps or better. Below that they are withheld rather than estimated.",
  "Two labels, control and defence, are right about 80% and 56% of the time. They are shown, but no conclusion is drawn from them.",
  "The camera has to be side-on, steady, with one table and both players in frame.",
];

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
      <p className="text-ink-muted mt-4 text-lg">
        PongAI reads a match from body movement alone. It never tracks the ball,
        and it needs nothing but a video.
      </p>

      <ol className="mt-10 space-y-8">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span
              aria-hidden
              className="bg-brand text-on-brand flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            >
              {i + 1}
            </span>
            <div>
              <h2 className="font-semibold">{s.title}</h2>
              <p className="text-ink-muted mt-1 text-sm">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-14">
        <h2 className="text-lg font-semibold">What it cannot tell you</h2>
        <p className="text-ink-muted mt-2 text-sm">
          Stated plainly, because a measurement you cannot trust is worse than
          one you do not have.
        </p>
        <ul className="mt-4 space-y-2">
          {LIMITS.map((l) => (
            <li key={l} className="text-ink-muted flex gap-2 text-sm">
              <span aria-hidden className="text-ink-subtle">
                —
              </span>
              {l}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-12 text-sm">
        <Link href="/" className="text-brand-text underline">
          Try a demo match
        </Link>{" "}
        — it loads instantly, and nothing is uploaded.
      </p>
    </div>
  );
}
