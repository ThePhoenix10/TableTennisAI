"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Playback } from "./use-playback";

/**
 * Playback backed by a real `<video>` element.
 *
 * Same `Playback` shape as the synthetic clock in `use-playback.ts`, so every
 * consumer — timeline playhead, panels, derived shot selection — is unchanged.
 * The screen picks one or the other depending on whether the match has footage.
 *
 * `timeupdate` alone fires only ~4×/second, far too coarse for a 120fps
 * timeline, so a rAF loop drives `time` while playing and `timeupdate` covers
 * seeks and pauses.
 */
export function useVideoPlayback(
  video: HTMLVideoElement | null,
  fallbackDuration: number,
): Playback {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  /**
   * Null until the element reports one. The fallback from the analysis JSON is
   * used until then, and forever if the video never loads — otherwise a failed
   * video would leave `duration` at the 0 this hook first mounted with, and
   * every seek would clamp to 0:00, silently killing all navigation.
   */
  const [elementDuration, setElementDuration] = useState<number | null>(null);
  const duration = elementDuration ?? fallbackDuration;
  const rafRef = useRef<number | null>(null);

  // The element is commanded imperatively (play, pause, seek), so it is held
  // in a ref rather than written through the argument.
  const elementRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    elementRef.current = video;
  }, [video]);

  /* Element events: the source of truth for play state, duration and seeks. */
  useEffect(() => {
    if (!video) return;

    const onTime = () => setTime(video.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMeta = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setElementDuration(video.duration);
      }
      setTime(video.currentTime);
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("durationchange", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("playing", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onPause);

    // Metadata may already have arrived before this effect ran.
    if (video.readyState >= 1) onMeta();

    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("playing", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onPause);
    };
  }, [video]);

  /* Fine-grained time while playing. */
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      if (video) setTime(video.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, video]);

  const play = useCallback(() => {
    // A rejected play() (autoplay policy, load failure) must not leave the UI
    // claiming to be playing.
    video?.play().catch(() => setPlaying(false));
  }, [video]);

  const pause = useCallback(() => video?.pause(), [video]);

  const toggle = useCallback(() => {
    if (!video) return;
    if (video.paused) play();
    else pause();
  }, [video, play, pause]);

  const seek = useCallback(
    (seconds: number) => {
      // Read through the ref, not the argument: this callback mutates the
      // element, which the immutability lint forbids on a hook argument. The
      // ref lags by one commit, which no user interaction can fall inside.
      const element = elementRef.current;
      const elementMax = element?.duration;
      // Falls back to the JSON duration when the element has none — a video
      // that failed to load must not collapse every seek to zero.
      const max =
        Number.isFinite(elementMax) && (elementMax as number) > 0
          ? (elementMax as number)
          : duration;
      const clamped = Math.min(Math.max(seconds, 0), max || 0);
      // Update state immediately: `seeked` can lag by a frame or two, and the
      // timeline should feel instant rather than animated.
      setTime(clamped);
      if (element) element.currentTime = clamped;
    },
    [duration],
  );

  return { time, playing, duration, play, pause, toggle, seek };
}
