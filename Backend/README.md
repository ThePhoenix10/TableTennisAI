# PongAI — Backend

Table-tennis video analysis from body pose alone. Upload a match, get back
every shot: when it happened, who played it, what kind of stroke it was, and
13 measured kinematics.

One repo, two services, one shared package.

```
pongai/
├── core/       imported by BOTH services
├── api/        FastAPI — HTTP, always running
└── worker/     GPU pipeline — runs to completion, exits
```

---

## Why one repo

`core` holds the shot schema and the validation rules. Split across two repos
they would drift within a month, and the failure is quiet: a user gets one
rejection message at upload and a different one an hour later.

**The import rule:**

```
api    → core     yes
worker → core     yes
api    → worker   never
worker → api      never
```

The worker communicates only through Table Storage. The API polls that table
to drive its progress stream. So the API can restart mid-job with no effect,
and the worker never needs the API to be up.

---

## `pongai/core/` — shared

### `schema.py`
Pydantic models forming the contract between API, worker and frontend.

- `Shot` — one detected stroke: identity, prediction, 13 kinematics, quality
- `Analysis` — a complete result plus signed URLs
- `Job` — status, stage, progress, errors
- `TrackHeader` — crop geometry for the player video panels

Also holds `CLASS_PRECISION`, the held-out accuracy per stroke class, as data
rather than prose. `control` (0.804) and `defence` (0.556) are too unreliable
to draw conclusions from, so the frontend suppresses them from findings — one
place to update when the model improves.

Kinematics are split into `POSITION_KINEMATICS` (valid at any frame rate) and
`VELOCITY_KINEMATICS` (require ≥60fps).

### `validation.py`
One rule set, three call sites: browser, API, worker.

- `Limits` — size 100 MB, duration 5 min, fps 30–240, min resolution, min
  aspect 1.2 (vertical video cannot work; a side-on view has to fit the whole
  table)
- `validate_probe()` — returns **all** problems at once, not just the first. A
  user with a long vertical 24fps clip should see three issues in one
  response rather than fix one and resubmit twice.
- `probe_file()` — ffprobe. The authoritative read.
- `validate_geometry()` — runs the table/player detector on ~10 sampled
  frames. Rejects footage where no table is found, or where both players sit
  on the same side of it. Catches phone video from a hall with six tables, or
  a 45° camera angle. Seconds of CPU, saves ~30 minutes of GPU producing
  confident nonsense.
- `limits_payload()` — served to the browser so it validates against the same
  numbers the worker enforces.

Rejections carry a machine-readable `code` and a human `message`, and a
severity: `reject` blocks, `warn` proceeds with reduced capability. A 30fps
clip is a warning — detection and classification survive (96% class agreement,
measured); only swing-speed metrics are withheld.

### `storage.py`
Azure Blob, Queue and Table access.

- `upload_sas()` — a SAS scoped to one blob path, create+write only,
  30-minute expiry. The browser PUTs directly; a 100 MB body never passes
  through the API.
- `read_sas()` — read-only URLs for results
- job persistence in Table Storage, partitioned by month
- queue enqueue and depth

### `progress.py`
Weighted stage progress.

```
validate        1%
activity_gate   4%
pose           60%   ← dominates
detect          1%
classify        1%
render         30%   ← second
upload          3%
```

Equal sevenths would jump to 43%, sit motionless for fifteen minutes during
pose extraction, then jump again — which reads as a hung job. `ProgressReporter`
writes to the job table (throttled) and suppresses ETA below 5% progress,
where the estimate is noise.

---

## `pongai/api/` — the HTTP service

FastAPI. Eleven routes across four modules.

| route | purpose |
|---|---|
| `GET /api/health` | liveness — deliberately does not touch storage |
| `GET /api/ready` | readiness — does |
| `GET /api/limits` | constraints, so browser and worker agree |
| `GET /api/demos` | precomputed matches |
| `GET /api/demos/{id}` | one demo, same shape as an analysis |
| `POST /api/uploads` | → `job_id` + scoped SAS |
| `POST /api/jobs/{id}/submit` | verify the blob landed, enqueue |
| `GET /api/jobs/{id}/stream` | **SSE** progress |
| `GET /api/jobs/{id}` | polling fallback |
| `GET /api/jobs` | history |
| `GET /api/analyses/{id}` | results + signed URLs |

### Why upload and submit are separate

A SAS can be issued and the upload then fail at 70%. If `POST /uploads`
enqueued the job, the worker would pick up a truncated file and fail deep in
the pipeline with a confusing error. Splitting them means the job only enters
the queue once the blob is verified — right size, right place. `submit` is
also idempotent, so a retried request cannot double-enqueue.

### The SSE stream

Polls the job table every 2s and pushes **only on change**. Sends `: ping`
keepalives every 15s, without which an idle connection gets closed by the
ingress. Sets `X-Accel-Buffering: no`, without which a proxy buffers events
and nothing arrives until the end.

The queued state gets its own wording, because the GPU scales to zero and the
first job after an idle period waits several minutes for a node and an image
pull. Saying only "queued" for six minutes reads as broken.

Events: `status`, `done`, `error`. The client closes on the last two, and
falls back to `GET /jobs/{id}` if the stream drops — a 40-minute connection
will sometimes not survive a laptop sleep.

---

## `pongai/worker/` — the GPU pipeline

### `run.py`
Queue consumer. Pulls one message, processes, exits — no HTTP server, no
health probe, no idle replica.

Re-probes the file with ffprobe and re-runs validation even for uploads the
API accepted, then runs the geometry check, then the pipeline. The API only
ever saw what the client claimed; a client can send anything, and rejecting
here costs seconds rather than half an hour of GPU.

Takes a job id as an argument for local testing: `python -m pongai.worker.run <job_id>`.

### `pipeline.py`
Orchestrates nine stages: activity gate → pose → resample → canonicalise →
contact detection → side attribution → classification → kinematics → rally
grouping → render.

Model loaders are `lru_cache`d so a warm container reuses them. Weights are
baked into the image (~115 MB) rather than downloaded — the job scales to
zero, so a runtime fetch would cost on every cold start and add an external
dependency.

### `stages/nets.py`
The two trained architectures. Two choices here were deliberate:

**`DetNet` keeps full temporal resolution.** A U-Net is the obvious shape for
per-frame prediction, but every stride-2 layer blurs peak location and this
model is scored at ±8 frames. Dilation reaches 2,033 frames of context
without losing precision.

**`ClsNet` uses attention pooling**, not the last hidden state. Contact sits
at index 60 of the 97-frame window; reading the final timestep would force the
decisive moment through 36 steps of decay.

### `stages/geometry.py`
COCO-17 layout, canonicalisation, frame-rate resampling.

`canonicalise()` hip-centres, torso-scales, and optionally mirrors. Torso
scale is a per-segment median, not per-frame — one bad frame would otherwise
rescale that frame's whole skeleton and inject a spike exactly where the
detector looks for one.

`resample_to_grid()` maps native-fps pose onto the 120fps grid the models were
trained on. **Positions are interpolated and velocity differenced afterwards.**
Computing velocity at 30fps and rescaling gives a different, wrong answer,
because consecutive-frame displacement spans 4× the time.

> On mirroring: a flip changes side *and* handedness together, so the four
> combinations form two closed orbits. `side XOR handedness` is invariant and
> physically real — a right-hander at the left end shows their forehand toward
> the camera, at the right end away. One binary residual is unavoidable. Side
> is a 50/50 split and handedness only ~4%, so side is what gets normalised.

### `stages/video.py`
Decode, activity gate, pose extraction, render.

`activity_gate()` keeps regions where both players are present and at least
one is moving. Decodes **sequentially** — `grab()` advances without converting
to BGR, `retrieve()` converts only sampled frames. A random seek per sampled
frame forces the decoder back to a keyframe and is **9.2× slower**, measured.

`extract_pose()` runs the detector on a stride and interpolates boxes between.
Detecting every frame would roughly double the cost for no gain, since players
move smoothly over a fraction of a second.

`build_crop_track()` produces crop centres for the player panels. Three
details decide whether the result is watchable:

- **fixed zoom** — the box grows and shrinks as a player moves toward the
  camera; following it makes them rescale constantly and posture impossible to
  compare across shots
- **smoothed centre** — raw boxes jitter several pixels, which magnified into
  a zoomed crop is a violent shake (91% reduction, measured)
- **gap filling** — where there is no detection the centre is interpolated so
  the crop holds still rather than snapping

`render()` draws skeletons on one video and pipes raw frames straight into
ffmpeg. Writing mp4v and re-encoding encodes every frame **twice** — that was
~17 of 24 minutes on a 12-minute clip. NVENC then encodes faster than the pipe
can feed it, so encoding overlaps with decode rather than following it.

Only one video is rendered. The player panels crop from it in the browser
using the track, which is a third of the render time and a third of the size
compared to baking a video per player.

### `stages/analysis.py`
Contact detection, classification, kinematics, rally grouping.

- `decode_peaks()` — peak-picking with NMS at 30 frames (0.25s; you cannot
  physically strike twice faster)
- `classify()` — temperature-scaled. The final model reported 95.7% mean
  confidence at ~79% accuracy; T was fitted on held-out predictions.
- `kinematics()` — 13 scalars. **Velocity metrics return `None` below 60fps.**
  At 30fps the wrist-speed peak is ~54% under-measured because that peak is
  only ~33ms wide. Returning a wrong number would be worse than none — the
  frontend would compare it against 120fps references and tell every
  phone-video user their swing is slow.
- `group_rallies()` — gaps over 1.5s. Validated against 282 annotated rally
  endings: boundary F1 0.769, with recall capped at 0.789 by the detection
  ceiling. The parameter is nearly irrelevant across a 5× range, which is a
  good sign — the method is not balanced on a hand-tuned constant.

---

## `tests/`

Pure logic only — no Azure, no GPU.

| file | covers |
|---|---|
| `test_validation.py` | accept/reject/warn cases, all-problems-at-once, fps boundary |
| `test_progress.py` | weights sum to 1, monotonic, ETA suppression |
| `test_analysis.py` | peak NMS, rally grouping, **velocity gating by fps** |
| `test_geometry.py` | canonicalisation, mirroring, resampling |

```
pip install -e ".[dev]"
pytest
```

### Not covered

**`worker/pipeline.py` has never been executed.** The stage logic is ported
and the pure-numpy parts are tested, but the GPU path — model loading,
RTMPose, NVENC, the full orchestration — is untested code.

Run it once locally against a known clip and **compare the shot count to the
notebook's output** before trusting it:

```
python -m pongai.worker.run <job_id>
```

---

## Running locally

```
pip install -e ".[api,dev]"
export AZURE_STORAGE_CONNECTION_STRING="..."
export ALLOWED_ORIGINS="http://localhost:3000"
uvicorn pongai.api.main:app --reload
```

Docs at `http://localhost:8000/docs`.

Before the worker runs, copy the weights into `pongai/worker/weights/`:

```
best.pt                custom YOLO — table + player
detector_final.pt      contact + side
classifier_final.pt    4-class + technique
rtmpose-l.onnx         pose
calibration.json       temperature + per-class thresholds
```

---

## Deployment

**TBD.**