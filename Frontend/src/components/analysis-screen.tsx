"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildRallies,
  formatClock,
  loadAnalysis,
  loadPoses,
  rallyAt,
  shotIndexAt,
} from "@/lib/analysis";
import { loadCropTrack, type CropTrack } from "@/lib/real-demo";
import {
  buildSegments,
  isInSegment,
  nextSegmentStart,
} from "@/lib/rally-segments";
import { useVideoPlayback } from "@/lib/use-video-playback";
import {
  CONTACT_INDEX,
  GRID_FPS,
  getDemoMatch,
  isSyntheticDemo,
} from "@/lib/constants";
import {
  computeFindings,
  reliableShotCount,
  type Finding,
} from "@/lib/findings";
import type { AnalysisFile, Player, ShotClass } from "@/lib/types";
import { usePlayback } from "@/lib/use-playback";
import { EvidenceMode } from "./evidence-mode";
import { FindingsSection } from "./findings-section";
import { MatchAnalytics } from "./match-analytics";
import { PlayerAnalytics } from "./player-analytics";
import { ShotTimeline } from "./shot-timeline";
import { SkeletonPanel } from "./skeleton-panel";
import { VideoStage } from "./video-stage";
import { WhatThisMeasures } from "./what-this-measures";

/** How long after contact a shot still counts as "in progress" on screen. */
const SHOT_HOLD_S = (97 - CONTACT_INDEX) / GRID_FPS;

export function AnalysisScreen({ id }: { id: string }) {
  const [file, setFile] = useState<AnalysisFile | null>(null);
  const [poses, setPoses] = useState<Float32Array | null>(null);
  const [track, setTrack] = useState<CropTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A non-fatal problem — the match still renders. */
  const [notice, setNotice] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<ShotClass | null>(null);
  const [playerFilter, setPlayerFilter] = useState<Player | null>(null);
  const [evidence, setEvidence] = useState<Finding | null>(null);
  /** While evidence mode is open, the pose panels follow the extreme clip. */
  const [evidenceShot, setEvidenceShot] = useState<number | null>(null);
  /** Skip the dead air between points. */
  const [ralliesOnly, setRalliesOnly] = useState(false);

  const demo = getDemoMatch(id);
  // The element lives in state, not a ref: the panels crop from it, so its
  // arrival has to trigger a render. A ref would populate silently.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const hasVideo = Boolean(file?.video_url);

  // Both hooks are called unconditionally — hooks cannot be conditional — and
  // the inactive one simply never advances. A real match takes its time from
  // the element; a synthetic one from the rAF clock.
  const syntheticPlayback = usePlayback(hasVideo ? 0 : (file?.duration_s ?? 0));
  const videoPlayback = useVideoPlayback(videoEl, file?.duration_s ?? 0);
  const playback = hasVideo ? videoPlayback : syntheticPlayback;
  const { time, seek, toggle } = playback;

  // The page keys this component on `id`, so a different match remounts and
  // no in-effect state reset is needed here.
  useEffect(() => {
    let cancelled = false;

    loadAnalysis(id)
      .then((loaded) => {
        if (cancelled) return;
        setFile(loaded);

        // Everything past this point is an enhancement: a missing sidecar
        // degrades one panel, and must never replace the whole screen with an
        // error. Failures are swallowed deliberately.
        void loadPoses(loaded)
          .then((p) => {
            if (!cancelled) setPoses(p);
          })
          .catch(() => {});

        if (loaded.video_url) {
          const cropsUnavailable = () =>
            setNotice(
              "Player crops are unavailable for this match — the crop track could not be loaded.",
            );
          void loadCropTrack(id)
            .then((t) => {
              if (cancelled) return;
              setTrack(t);
              if (!t) cropsUnavailable();
            })
            // A rejected fetch is the same outcome for the user as a missing
            // file, so it must not be silently different.
            .catch(() => {
              if (!cancelled) cropsUnavailable();
            });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Could not load this match",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const shots = useMemo(() => file?.shots ?? [], [file]);
  const rallies = useMemo(() => buildRallies(shots), [shots]);

  const segments = useMemo(
    () => buildSegments(rallies, file?.duration_s ?? 0),
    [rallies, file?.duration_s],
  );
  const compressing = ralliesOnly && segments.length > 0;

  const leftShots = useMemo(
    () => shots.filter((s) => s.player === "left"),
    [shots],
  );
  const rightShots = useMemo(
    () => shots.filter((s) => s.player === "right"),
    [shots],
  );

  const sourceFps = file?.source_fps ?? 0;
  const leftFindings = useMemo(
    () => (shots.length ? computeFindings(shots, "left", sourceFps) : []),
    [shots, sourceFps],
  );
  const rightFindings = useMemo(
    () => (shots.length ? computeFindings(shots, "right", sourceFps) : []),
    [shots, sourceFps],
  );
  const findingCount = leftFindings.length + rightFindings.length;

  /**
   * Indices surviving the active filters. Null means "no filter".
   *
   * Evidence mode overrides the class/player filters: while it is open the
   * timeline shows exactly the six shots under comparison.
   */
  const visible = useMemo(() => {
    if (evidence) {
      return new Set([
        ...evidence.evidence.extremeShots,
        ...evidence.evidence.typicalShots,
      ]);
    }
    if (!classFilter && !playerFilter) return null;
    const set = new Set<number>();
    shots.forEach((shot, i) => {
      if (classFilter && shot.shot_class !== classFilter) return;
      if (playerFilter && shot.player !== playerFilter) return;
      set.add(i);
    });
    return set;
  }, [shots, classFilter, playerFilter, evidence]);

  /**
   * Selection is derived, not stored: selecting a shot seeks to its timestamp,
   * so "the current shot" is always the most recent one at or before `time`.
   * That keeps clicking and playback from fighting over the same state.
   *
   * -1 before the first shot. Clamping to 0 here would make shot 1 read as
   * "current" during the opening seconds, when nothing has happened yet
   * (revision 2 §9), so the null state is preserved and handled downstream.
   */
  const selectedIndex = useMemo(() => shotIndexAt(shots, time), [shots, time]);

  const select = useCallback(
    (index: number) => {
      const shot = shots[index];
      if (shot) seek(shot.timestamp_s);
    },
    [shots, seek],
  );

  /**
   * In rallies-only mode, jump the gaps.
   *
   * Runs on any landing outside a segment, whether from playback running off
   * the end of a point or from the user scrubbing into dead air. `isInSegment`
   * carries boundary slack, without which a seek that lands a few milliseconds
   * short of a segment start would be skipped forward again on every tick.
   */
  const lastSkipRef = useRef<number | null>(null);
  useEffect(() => {
    if (!compressing) {
      lastSkipRef.current = null;
      return;
    }
    if (isInSegment(segments, time)) {
      lastSkipRef.current = null;
      return;
    }

    const next = nextSegmentStart(segments, time);
    if (next === null) {
      // Past the last rally: stop rather than play out the trailing footage.
      if (playback.playing) playback.pause();
      return;
    }
    // Guard against re-issuing a seek the element has not honoured yet.
    if (lastSkipRef.current === next) return;
    lastSkipRef.current = next;
    seek(next);
  }, [compressing, segments, time, seek, playback]);

  /* Keyboard: ←/→ shot, Shift+←/→ rally, Space play/pause (spec §6.1). */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never hijack keys aimed at a control the user is operating.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        toggle();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();

      const step = event.key === "ArrowRight" ? 1 : -1;

      if (event.shiftKey) {
        const current = shots[selectedIndex];
        const rallyPos = rallies.findIndex((r) => r.id === current?.rally_id);
        const nextRally = rallies[rallyPos + step];
        if (nextRally) {
          const target = shots.findIndex(
            (s) => s.rally_id === nextRally.id && s.shot_index === 0,
          );
          if (target >= 0) select(target);
        }
        return;
      }

      // From the null state before the first shot, either arrow enters there.
      if (selectedIndex < 0) {
        select(0);
        return;
      }
      // Past either end, do nothing. Clamping instead would re-select the shot
      // already showing — which, past the last shot, seeks BACKWARDS to it.
      const next = selectedIndex + step;
      if (next < 0 || next >= shots.length) return;
      select(next);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shots, rallies, selectedIndex, select, toggle]);

  if (error) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
        <p className="text-base">{error}</p>
        {isSyntheticDemo(id) && (
          <p className="text-ink-muted mt-2 text-sm">
            Synthetic fixtures are generated — try{" "}
            <code>npm run generate:demo</code>.
          </p>
        )}
      </div>
    );
  }

  if (!file) {
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6">
        <p className="text-ink-muted text-sm">Loading match…</p>
      </div>
    );
  }

  const activeRally = rallyAt(rallies, time);
  // Null before the first shot — nothing has happened yet, so nothing is current.
  const selected = selectedIndex >= 0 ? (shots[selectedIndex] ?? null) : null;
  // A shot is "on screen" only around its own contact moment.
  const liveShot =
    selected &&
    time >= selected.timestamp_s - 0.4 &&
    time <= selected.timestamp_s + SHOT_HOLD_S
      ? selected
      : null;

  // A running count during playback; evidence mode has no playhead, so it
  // shows the player's match total rather than a misleading zero.
  const shotsSoFar = (player: Player) =>
    shots.filter(
      (s) => s.player === player && (evidence || s.timestamp_s <= time),
    ).length;

  const panelFor = (player: Player) => {
    // In evidence mode the panels track the extreme clip rather than playback,
    // so the coach sees the shot being argued about (revision 2 §4).
    if (evidence && evidenceShot !== null) {
      const shot = shots[evidenceShot];
      const mine = shot?.player === player;
      return {
        shot: mine ? shot : null,
        shotIndex: mine ? evidenceShot : null,
        offsetS: 0,
      };
    }
    const isLive = liveShot?.player === player;
    return {
      shot: isLive ? liveShot : null,
      shotIndex: isLive ? selectedIndex : null,
      offsetS: isLive ? time - liveShot.timestamp_s : 0,
    };
  };

  const left = panelFor("left");
  const right = panelFor("right");

  const openEvidence = (f: Finding) => {
    setEvidence(f);
    document
      .getElementById("stage")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const closeEvidence = () => {
    setEvidence(null);
    setEvidenceShot(null);
  };

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">
          {demo?.title ?? file.video_id}
          <span className="text-ink-muted ml-2 font-mono text-sm font-normal">
            {file.video_id}
          </span>
        </h1>
        <p data-numeric className="text-ink-muted font-mono text-sm">
          {Math.round(file.source_fps)}fps · {formatClock(file.duration_s)} ·{" "}
          {shots.length} shots · {rallies.length} rallies
          {findingCount > 0 && (
            <>
              {" · "}
              {/* Tells the coach something is below the fold, and jumps there. */}
              <a href="#findings" className="text-brand-text underline">
                {findingCount} finding{findingCount === 1 ? "" : "s"} ↓
              </a>
            </>
          )}
        </p>
      </header>

      {/* Keyed off the registry, not off a field the real export happens to
          omit, so a malformed file can never pass itself off as real. */}
      {isSyntheticDemo(id) && (
        <p className="border-border bg-surface text-ink-muted rounded-card border p-3 text-xs">
          Demo data is synthetic — generated to exercise the interface. The
          numbers describe no real match.
        </p>
      )}

      {notice && (
        <p className="border-border bg-surface text-ink-muted rounded-card border p-3 text-xs">
          {notice}
        </p>
      )}

      {/* Row 1: skeleton · video (or evidence mode) · skeleton */}
      <div
        id="stage"
        className="grid scroll-mt-4 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]"
      >
        <SkeletonPanel
          player="left"
          label="Left player"
          shot={left.shot}
          shotIndex={left.shotIndex}
          poses={poses}
          offsetS={left.offsetS}
          shotCount={shotsSoFar("left")}
          active={left.shot !== null}
          track={track}
          video={videoEl}
          currentTime={time}
          videoReady={videoReady}
        />

        {/* The stage is HIDDEN rather than unmounted while evidence mode is
            open: unmounting would tear down the <video>, losing the playhead
            and re-downloading a 100MB file on close. The panels also crop from
            that element, so it has to stay alive. */}
        <div className={evidence ? "hidden" : "contents"}>
          <VideoStage
            file={file}
            playback={playback}
            rally={activeRally}
            rallyCount={rallies.length}
            selected={selected}
            videoRef={setVideoEl}
            onVideoReady={() => setVideoReady(true)}
            onVideoError={setNotice}
            segments={segments}
            ralliesOnly={ralliesOnly}
            onRalliesOnlyChange={setRalliesOnly}
          />
        </div>

        {evidence && (
          <EvidenceMode
            finding={evidence}
            shots={shots}
            poses={poses}
            onClose={closeEvidence}
            onExtremeShot={setEvidenceShot}
          />
        )}

        <SkeletonPanel
          player="right"
          label="Right player"
          shot={right.shot}
          shotIndex={right.shotIndex}
          poses={poses}
          offsetS={right.offsetS}
          shotCount={shotsSoFar("right")}
          active={right.shot !== null}
          track={track}
          video={videoEl}
          currentTime={time}
          videoReady={videoReady}
        />
      </div>

      {/* Row 2: full-width timeline — the primary navigation control */}
      <ShotTimeline
        shots={shots}
        rallies={rallies}
        duration={file.duration_s}
        time={time}
        selectedIndex={selectedIndex}
        visible={visible}
        onSelect={select}
        segments={compressing ? segments : null}
      />

      {evidence ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-muted">
            Timeline filtered to the 6 shots in this comparison
          </span>
          <button
            type="button"
            onClick={closeEvidence}
            className="text-brand-text rounded underline"
          >
            Clear
          </button>
        </div>
      ) : (
        (classFilter || playerFilter) && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-muted">Filtered to</span>
            {playerFilter && (
              <span className="border-border rounded border px-2 py-0.5">
                {playerFilter} player
              </span>
            )}
            {classFilter && (
              <span className="border-border rounded border px-2 py-0.5">
                {classFilter}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setClassFilter(null);
                setPlayerFilter(null);
              }}
              className="text-brand-text rounded underline"
            >
              Clear
            </button>
          </div>
        )
      )}

      {/* Row 3: the findings — the primary output of the screen */}
      <FindingsSection
        left={leftFindings}
        right={rightFindings}
        leftReliable={reliableShotCount(shots, "left")}
        rightReliable={reliableShotCount(shots, "right")}
        shots={shots}
        onShowMe={openEvidence}
        activeId={evidence?.id ?? null}
      />

      {/* Row 4: everything else, behind a disclosure */}
      <details className="rounded-card border-border bg-surface border">
        <summary className="cursor-pointer px-4 py-3 text-base font-semibold">
          Full analysis
        </summary>
        <div className="border-border flex flex-col gap-4 border-t p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
            <PlayerAnalytics
              label="Left player"
              shots={leftShots}
              sourceFps={file.source_fps}
              activeClassFilter={playerFilter === "left" ? classFilter : null}
              onFilterClass={(c) => {
                setClassFilter(c);
                setPlayerFilter(c ? "left" : null);
              }}
              onFilterPlayer={() =>
                setPlayerFilter(playerFilter === "left" ? null : "left")
              }
              playerFiltered={playerFilter === "left"}
            />

            <MatchAnalytics file={file} rallies={rallies} />

            <PlayerAnalytics
              label="Right player"
              shots={rightShots}
              sourceFps={file.source_fps}
              activeClassFilter={playerFilter === "right" ? classFilter : null}
              onFilterClass={(c) => {
                setClassFilter(c);
                setPlayerFilter(c ? "right" : null);
              }}
              onFilterPlayer={() =>
                setPlayerFilter(playerFilter === "right" ? null : "right")
              }
              playerFiltered={playerFilter === "right"}
            />
          </div>

          {/* Transcript-equivalent of the timeline, for screen readers (§12). */}
          <details className="rounded-card border-border bg-surface border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
              Shot list ({shots.length})
            </summary>
            <div className="border-border max-h-96 overflow-auto border-t">
              <table className="w-full text-xs">
                <caption className="sr-only">
                  Every detected shot, in order of time
                </caption>
                <thead className="bg-bg sticky top-0">
                  <tr>
                    {[
                      "Time",
                      "Rally",
                      "#",
                      "Player",
                      "Class",
                      "Confidence",
                      "Label",
                    ].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="p-2 text-left font-semibold"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shots.map((shot, i) => (
                    <tr
                      key={`${shot.rally_id}-${shot.shot_index}`}
                      className="border-border border-t"
                    >
                      <td data-numeric className="p-2 font-mono">
                        <button
                          type="button"
                          onClick={() => select(i)}
                          className="text-brand-text rounded underline"
                        >
                          {formatClock(shot.timestamp_s)}
                        </button>
                      </td>
                      <td data-numeric className="p-2 font-mono">
                        {shot.rally_id + 1}
                      </td>
                      <td data-numeric className="p-2 font-mono">
                        {shot.shot_index + 1}
                      </td>
                      <td className="p-2">{shot.player}</td>
                      <td className="p-2">{shot.shot_class}</td>
                      <td data-numeric className="p-2 font-mono">
                        {(shot.class_confidence * 100).toFixed(0)}%
                      </td>
                      <td className="p-2">
                        {shot.abstain ? "uncertain" : "reliable"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </details>

      <WhatThisMeasures />
    </div>
  );
}
