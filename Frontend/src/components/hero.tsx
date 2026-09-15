"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "./session-provider";
import { useUploadAction } from "@/lib/use-upload-action";

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
  if (reduced) {
    return <img src="/hero/rally-poster.jpg" alt="" aria-hidden className="h-full w-full object-cover" />;
  }
  return (
    <video
      src="/hero/rally.mp4"
      poster="/hero/rally-poster.jpg"
      autoPlay muted loop playsInline aria-hidden
      className="h-full w-full object-cover"
    />
  );
}

export function Hero() {
  const uploadVideo = useUploadAction();
  const { user, ready } = useSession();
  const secondary = ready && user ? "Go to dashboard" : "Upload your match";

  return (
    <section className="relative overflow-hidden">
      {/* Full-bleed video */}
      <div className="relative aspect-video w-full overflow-hidden lg:aspect-[12/5]">
        <HeroMedia />
        {/* Gradient: dark at bottom for text legibility on mobile, clear at top */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.28) 45%, rgba(0,0,0,0.05) 100%)",
          }}
        />
        {/* Desktop: left-side text panel with a vertical gradient  */}
        <div
          aria-hidden
          className="absolute inset-0 hidden lg:block"
          style={{
            background: "linear-gradient(to right, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.45) 38%, rgba(0,0,0,0.00) 65%)",
          }}
        />

        {/* Desktop copy — left-aligned over video */}
        <div className="absolute inset-0 hidden lg:flex items-end pb-12 px-10 xl:px-16">
          <div className="max-w-xl">
            <div
              className="hero-rise mb-5 inline-flex items-center gap-2 rounded-full border border-orange-400/40 bg-orange-500/20 px-4 py-1.5 text-xs font-semibold text-orange-200 backdrop-blur-sm"
              style={{ animationDelay: "60ms" }}
            >
              <span className="size-1.5 rounded-full bg-orange-400 inline-block" />
              AI-powered table tennis analysis
            </div>

            <h1
              className="hero-rise text-[length:var(--text-display)] font-bold leading-[1.05] tracking-tight text-white"
              style={{ animationDelay: "120ms" }}
            >
              Every shot.<br />
              <span className="gradient-text">Understood.</span>
            </h1>

            <p
              className="hero-rise mt-5 text-base text-white/75 max-w-md leading-relaxed"
              style={{ animationDelay: "200ms" }}
            >
              PongAI reads your match from body movement alone — no ball tracking, no sensors. Every shot timed, attributed and measured.
            </p>

            <div
              className="hero-rise mt-8 flex flex-wrap gap-3"
              style={{ animationDelay: "280ms" }}
            >
              <Link
                href="/analysis/game_1/"
                className="rounded-xl gradient-brand px-6 py-3 text-sm font-bold text-white shadow-lg hover:opacity-90 transition-opacity glow-brand"
              >
                Watch Demo
              </Link>
              <button
                type="button"
                onClick={uploadVideo}
                className="cursor-pointer rounded-xl border border-white/25 bg-white/10 px-6 py-3 text-sm font-semibold text-white hover:bg-white/20 transition-all backdrop-blur-sm"
              >
                {secondary}
              </button>
            </div>

            {/* Inline stats */}
            <div
              className="hero-rise mt-10 flex gap-8"
              style={{ animationDelay: "360ms" }}
            >
              {[
                { value: "99.4%", label: "Attribution accuracy" },
                { value: "120fps", label: "Pose tracking" },
                { value: "13", label: "Metrics per shot" },
              ].map((s) => (
                <div key={s.label}>
                  <div className="text-2xl font-bold text-white tabular-nums">{s.value}</div>
                  <div className="mt-0.5 text-xs text-white/45 uppercase tracking-wide">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile copy — below video */}
      <div className="bg-slate-900 px-5 pt-8 pb-10 lg:hidden">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-500/15 px-4 py-1.5 text-xs font-semibold text-orange-400">
          <span className="size-1.5 rounded-full bg-orange-400 inline-block" />
          AI-powered table tennis analysis
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Every shot.<br />
          <span className="gradient-text">Understood.</span>
        </h1>
        <p className="mt-4 text-sm text-slate-400 leading-relaxed">
          PongAI reads your match from body movement alone — no ball tracking, no sensors. Every shot timed, attributed and measured.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/analysis/game_1/"
            className="rounded-xl gradient-brand px-5 py-2.5 text-sm font-bold text-white glow-brand"
          >
            Watch Demo
          </Link>
          <button
            type="button"
            onClick={uploadVideo}
            className="cursor-pointer rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-300"
          >
            {secondary}
          </button>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-4 border-t border-white/10 pt-8">
          {[
            { value: "99.4%", label: "Attribution" },
            { value: "120fps", label: "Tracking" },
            { value: "13", label: "Metrics/shot" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-xl font-bold text-white tabular-nums">{s.value}</div>
              <div className="mt-0.5 text-xs text-slate-500 uppercase tracking-wide">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}