import assert from "node:assert/strict";
import { test } from "node:test";
import { toAnalysisFile } from "./live-analysis";
import type { Analysis } from "./api-types";
import type { Shot } from "./types";

/** A real response from GET /api/analyses/{id}, trimmed to one shot. */
const API_RESPONSE: Analysis = {
  meta: {
    video_id: "Game-Test",
    duration_s: 9.275,
    source_fps: 120,
    width: 1600,
    height: 900,
    n_shots: 3,
    n_rallies: 1,
    schema_version: 1,
    velocity_reliable: true,
  },
  shots: [
    {
      rally_id: 0,
      shot_index: 0,
      player: "right",
      frame: 365,
      timestamp_s: 3.0416667461395264,
      shot_class: "serve",
      class_confidence: 0.9674838185310364,
      technique: "serve",
      abstain: false,
      detect_confidence: 0.99,
      backswing_amplitude: 1.2,
      contact_height: 0.3,
      elbow_angle: 110,
      elbow_range: 60,
      trunk_lean: 12,
      trunk_rotation: 40,
      table_distance: 1.8,
      stance_width: 0.6,
      knee_angle: 150,
      peak_wrist_speed: 0.774,
      time_to_peak: -2,
      follow_through: 8,
      recovery_time: 12,
      rally_length: 3,
      pose_confidence: 0.8,
      detected: 1,
    } as Shot,
  ],
  video_url: "https://blob/video.mp4?sig=x",
  track_url: "https://blob/track.json?sig=x",
  track_bin_url: "https://blob/track.bin?sig=x",
  thumb_url: "https://blob/thumb.jpg?sig=x",
};

test("flattens meta to the shape the analysis screen reads", () => {
  const f = toAnalysisFile(API_RESPONSE);
  assert.equal(f.video_id, "Game-Test");
  assert.equal(f.duration_s, 9.275);
  assert.equal(f.source_fps, 120);
  assert.equal(f.width, 1600);
  assert.equal(f.height, 900);
  assert.equal(f.video_url, API_RESPONSE.video_url);
});

test("carries shots through untouched", () => {
  // The shot record is one contract, defined in the backend. Reshaping it here
  // is how a live analysis would start disagreeing with a demo.
  const f = toAnalysisFile(API_RESPONSE);
  assert.deepEqual(f.shots, API_RESPONSE.shots);
  assert.equal(f.shots[0].shot_class, "serve");
  assert.equal(f.shots[0].peak_wrist_speed, 0.774);
});

test("emits no pose sidecar, like a real export", () => {
  // Real analyses burn the skeleton into the video, so everything downstream
  // must treat missing pose windows as normal rather than as a failure.
  const f = toAnalysisFile(API_RESPONSE);
  assert.equal(f.poses_url, undefined);
  assert.equal(f.synthetic, undefined);
});
