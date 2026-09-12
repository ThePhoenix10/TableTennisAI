"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "./session-provider";
import { useUploadAction } from "@/lib/use-upload-action";

/**
 * The landing hero: a real analysed rally, looping.
 *
 * The footage is the product. A still cannot show what PongAI does — the
 * point is that the skeletons track two players through a rally — so the
 * hero is four seconds of an actual analysis, cut from the demo match, at
 * 349 KB.
 *
 * Regenerating the clip: see public/hero/README.md.
 */

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

function HeroMedia() {
  const reduced = useReducedMotion();

  // Autoplaying video is motion. Someone who has asked for less of it gets the
  // poster frame instead — same image, no movement, no download.
  if (reduced) {
    return (
      // A fixed-size decorative poster; next/image would add a loader and
      // layout machinery for no gain.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/hero/rally-poster.jpg"
        alt=""
        aria-hidden
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    // Decorative: the heading beside it carries the meaning, so it is hidden
    // from assistive technology rather than described.
    <video
      src="/hero/rally.mp4"
      poster="/hero/rally-poster.jpg"
      autoPlay
      muted
      loop
      playsInline
      aria-hidden
      className="h-full w-full object-cover"
    />
  );
}

export function Hero() {
  const uploadVideo = useUploadAction();
  const { user, ready } = useSession();
  // Signed in, "upload your match" is the wrong invitation: they have an
  // account and a workspace, and want to get to it.
  const secondary =
    ready && user ? "Go to your dashboard" : "Upload your match";

  return (
    <section className="border-border border-b bg-black">
      <div className="relative mx-auto max-w-[1600px]">
        {/* Below lg the clip keeps its own 16:9 and the copy sits underneath:
            both players are in the outer thirds, so cropping to fit a phone
            would cut one of them out.

            Above lg it is cropped to a wide band. The source frame is mostly
            curtain at the top and floor at the bottom, neither of which says
            anything; trimming them puts the players and their skeletons across
            the middle and keeps the hero from swallowing the fold. */}
        <div className="relative aspect-video w-full overflow-hidden lg:aspect-[12/5]">
          <HeroMedia />

          {/* Legibility scrim, only where the copy overlays.

              Radial rather than a top-to-bottom gradient, because the copy is
              centred in both axes: the dark needs to sit behind the middle of
              the frame, not the bottom of it. The players stand in the outer
              thirds, outside this ellipse, so they keep their contrast while
              the table behind the text is darkened. A faint flat wash under it
              guards the edges, since the footage is bright. */}
          <div
            aria-hidden
            className="absolute inset-0 hidden lg:block"
            style={{
              background:
                "radial-gradient(ellipse 58% 72% at 50% 50%, rgba(0,0,0,.74) 0%, rgba(0,0,0,.52) 45%, rgba(0,0,0,.10) 100%), linear-gradient(rgba(0,0,0,.14), rgba(0,0,0,.14))",
            }}
          />

          <div className="absolute inset-0 hidden items-center lg:flex">
            <div className="w-full px-6 py-10 xl:px-10">
              <HeroCopy onUpload={uploadVideo} secondary={secondary} />
            </div>
          </div>
        </div>

        {/* Stacked below the video on narrow screens, on solid ground, where
            contrast is guaranteed and nothing is cropped away. */}
        <div className="px-4 pt-8 pb-10 sm:px-6 lg:hidden">
          <HeroCopy onUpload={uploadVideo} secondary={secondary} />
        </div>
      </div>
    </section>
  );
}

function HeroCopy({
  onUpload,
  secondary,
}: {
  onUpload: () => void;
  secondary: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center text-white">
      <h1 className="hero-rise flex items-center justify-center gap-3 text-[length:var(--text-display)] leading-[1.05] font-semibold tracking-tight">
        <span
          aria-hidden
          className="hero-dot bg-brand inline-block size-[0.42em] shrink-0 rounded-full"
          style={{ animationDelay: "120ms" }}
        />
        PongAI
      </h1>

      <p
        className="hero-rise mt-4 text-lg font-medium text-balance text-white/95"
        style={{ animationDelay: "160ms" }}
      >
        Every shot timed, attributed, classified and measured, from body
        movement alone.
      </p>
      <p
        className="hero-rise mt-2 text-sm text-white/70"
        style={{ animationDelay: "240ms" }}
      >
        No ball tracking. No sensors. Just a video of your match.
      </p>

      <div
        className="hero-rise mt-8 flex flex-wrap justify-center gap-3"
        style={{ animationDelay: "320ms" }}
      >
        <Link
          href="/analysis/game_1/"
          className="bg-brand text-on-brand hover:bg-brand-hover rounded px-5 py-2.5 text-sm font-medium"
        >
          Watch a real analysis
        </Link>
        <button
          type="button"
          onClick={onUpload}
          className="cursor-pointer rounded border border-white/40 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/10"
        >
          {secondary}
        </button>
      </div>
    </div>
  );
}
