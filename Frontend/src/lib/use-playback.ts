"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The single time source everything on the analysis screen subscribes to:
 * skeletons, timeline playhead, and the "current" markers in the analytics
 * panels (addendum §1).
 *
 * No match footage exists yet, so this drives from a rAF clock. When real
 * video arrives, back `time` with the element's `currentTime` and keep this
 * API — nothing downstream needs to change.
 */
export interface Playback {
  time: number;
  playing: boolean;
  duration: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
}

export function usePlayback(duration: number): Playback {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Refs, not state, so the rAF loop never restarts mid-playback.
  const frameRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const timeRef = useRef(0);

  const commit = useCallback(
    (next: number) => {
      const clamped = Math.min(duration, Math.max(0, next));
      timeRef.current = clamped;
      setTime(clamped);
      return clamped;
    },
    [duration],
  );

  useEffect(() => {
    if (!playing) return;

    const tick = (now: number) => {
      const last = lastTickRef.current;
      lastTickRef.current = now;

      if (last !== null) {
        const next = commit(timeRef.current + (now - last) / 1000);
        if (next >= duration) {
          setPlaying(false);
          lastTickRef.current = null;
          return;
        }
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      lastTickRef.current = null;
    };
  }, [playing, duration, commit]);

  const seek = useCallback(
    (seconds: number) => {
      commit(seconds);
    },
    [commit],
  );

  const play = useCallback(() => {
    // Restarting from the end should replay rather than sit still.
    if (timeRef.current >= duration) commit(0);
    setPlaying(true);
  }, [duration, commit]);

  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(
    () => (playing ? pause() : play()),
    [playing, pause, play],
  );

  return { time, playing, duration, play, pause, toggle, seek };
}
