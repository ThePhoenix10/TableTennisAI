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
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/hero/rally-poster.jpg" alt="" aria-hidden className="h-full w-full object-cover" />
    );
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
  const secondary = ready && user ? "Go to your dashboard" : "Upload your match";

  return (
    <section className="relative border-b border-slate-200 overflow-hidden">
      <div className="relative mx-auto max-w-[1600px]">
        <div className="relative aspect-video w-full overflow-hidden lg:aspect-[12/5]">
          <HeroMedia />

          {/* Minimal scrim — only behind text, keeps video bright */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 55% 70% at 50% 48%, rgba(0,0,0,.40) 0%, rgba(0,0,0,.12) 55%, rgba(0,0,0,.00) 100%)",
            }}
          />

          {/* Desktop copy — over video */}
          <div className="absolute inset-0 hidden items-center lg:flex" style={{ zIndex: 10 }}>
            <div className="w-full px-6 py-10 xl:px-10">
              <HeroCopy onUpload={uploadVideo} secondary={secondary} textOnVideo />
            </div>
          </div>
        </div>

        {/* Mobile copy — below video on light background */}
        <div className="bg-white px-4 pt-10 pb-12 sm:px-6 lg:hidden border-t border-slate-100">
          <HeroCopy onUpload={uploadVideo} secondary={secondary} textOnVideo={false} />
        </div>
      </div>
    </section>
  );
}

function HeroCopy({
  onUpload,
  secondary,
  textOnVideo,
}: {
  onUpload: () => void;
  secondary: string;
  textOnVideo: boolean;
}) {
  const headingColor = textOnVideo ? "text-white" : "text-slate-900";
  const subColor = textOnVideo ? "text-white/80" : "text-slate-600";
  const captionColor = textOnVideo ? "text-white/55" : "text-slate-400";

  return (
    <div className="mx-auto max-w-2xl text-center">
      <div
        className={`hero-rise mb-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium backdrop-blur-sm ${
          textOnVideo
            ? "border border-white/20 bg-white/10 text-white/80"
            : "border border-orange-200 bg-orange-50 text-orange-600"
        }`}
        style={{ animationDelay: "80ms" }}
      >
        <span className="inline-block size-1.5 rounded-full bg-orange-400" />
        AI-powered table tennis analysis
      </div>

      <h1
        className={`hero-rise text-[length:var(--text-display)] leading-[1.05] font-bold tracking-tight gradient-text`}
        style={{ animationDelay: "120ms" }}
      >
        PongAI
      </h1>

      <p className={`hero-rise mt-4 text-lg font-medium text-balance ${headingColor}`} style={{ animationDelay: "160ms" }}>
        Every shot timed, attributed, classified and measured,{" "}
        <span className="text-orange-400">from body movement alone.</span>
      </p>
      <p className={`hero-rise mt-2 text-sm ${captionColor}`} style={{ animationDelay: "240ms" }}>
        No ball tracking. No sensors. Just a video of your match.
      </p>

      <div className="hero-rise mt-10 flex flex-wrap justify-center gap-4" style={{ animationDelay: "320ms" }}>
        <Link
          href="/analysis/game_1/"
          className="rounded-xl gradient-brand px-6 py-3 text-sm font-semibold text-white shadow-lg hover:opacity-90 transition-opacity glow-brand"
        >
          Watch Demo analysis
        </Link>
        <button
          type="button"
          onClick={onUpload}
          className={`cursor-pointer rounded-xl px-6 py-3 text-sm font-semibold transition-all ${
            textOnVideo
              ? "border border-white/25 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
              : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm"
          }`}
        >
          {secondary}
        </button>
      </div>

      <div className="hero-rise mt-12 flex flex-wrap justify-center gap-8 text-center" style={{ animationDelay: "400ms" }}>
        {[
          { value: "99.4%", label: "Attribution accuracy" },
          { value: "120fps", label: "Pose tracking" },
          { value: "13", label: "Measurements per shot" },
        ].map((stat) => (
          <div key={stat.label}>
            <div className={`text-xl font-bold drop-shadow ${headingColor}`}>{stat.value}</div>
            <div className={`mt-0.5 text-xs ${captionColor}`}>{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}