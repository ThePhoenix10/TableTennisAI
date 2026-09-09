# PongAI

**A table-tennis analysis system that detects rallies and shots from body movement alone, built toward an AI coach that gives technique feedback.**

Status: Phase 1 and Phase 2 complete and validated. Phase 2.5 (3D pose) is next. Last updated 7 September 2026.

---

# 1. What this project is about

## The problem

Improving at table tennis requires knowing what you *did*, not just whether you won. A coach watching you play sees things you cannot see yourself: your backswing is too short on the forehand, you recover late after attacking, you drift too far from the table on the backhand side.

That feedback is expensive and rare. A coach costs money, is available at certain times, and cannot watch every point you play. Most amateurs play hundreds of matches with almost no structured feedback on their technique.

Meanwhile, everyone has a phone that can record a match.

## The goal

Given a video of a match, produce:

1. **When** each shot was played, to within a few tens of milliseconds
2. **Who** played it
3. **What kind** of shot it was
4. **How** it was played, as measurable kinematics
5. **Rally structure**, meaning where points begin and end

Longer term, use that to give **technique feedback**: not "that was an attack", but "your backswing was 30% shorter than your usual loop, and it varies more than anything else in your game."

## Why it is hard

Table tennis is close to the worst case for computer vision in sport.

| | |
|---|---|
| **Speed** | A stroke's acceleration phase is about 120 ms. At 30 fps that is 3 to 4 frames. |
| **Ball size** | 40 mm, often motion-blurred to a smear or invisible entirely. |
| **Stroke similarity** | A block and a compact loop look nearly identical in body terms. The difference is racket angle and spin. |
| **Rally density** | Contacts every 0.7 s or so, so a detector must be temporally *precise*, not just accurate. |
| **Occlusion** | The table hides the lower body; players turn away from the camera. |

## The self-imposed constraint

**Body kinematics only. No ball tracking, no audio.**

This is a deliberate scoping decision. Ball tracking in table tennis is a hard research problem in itself, being a small, fast, frequently occluded object against a cluttered background, and building it would have consumed the whole project. Audio-based contact detection works well but fails in a noisy hall where six tables are in play, which is exactly where amateur matches happen.

Body pose, by contrast, is largely solved, with strong off-the-shelf models. So the question worth answering became: **how far can you get from the body alone?**

That question now has a measured answer, including where it stops being possible.

## Does an AI coach already exist?

Not in the form this project is aiming at. What exists falls into four groups.

**Sensor-based products.** Racket-mounted IMUs give accurate swing data such as speed, spin axis and impact. But they need hardware on every racket, tell you nothing about body position or footwork, and cannot analyse video you already have.

**Broadcast analytics.** Professional systems produce shot placement and rally statistics for televised matches. They depend on multi-camera rigs, calibrated venues and manual annotation. Not applicable to a phone recording of a club match.

**Generic pose apps.** Several fitness and golf apps overlay skeletons on video and report joint angles. They do not understand table tennis: no shot detection, no stroke classification, no rally structure. A skeleton on a video is not coaching.

**Academic stroke classifiers.** These exist and work well, but they classify *pre-trimmed clips* and output a *label*. None locate strokes in continuous video, and none output the kinematics a coach would actually talk about.

So there is a real gap: nothing takes an ordinary video of a match and returns per-shot mechanics.

---

# 2. Existing research and the gaps

## Three lines of work

They barely reference each other, which is itself informative.

### Player-centric video, TTStroke-21 (Bordeaux)

The main academic benchmark: player-centred clips, 20 stroke classes.

- Martin et al., twin RGB and optical-flow spatio-temporal CNNs, **91.4%**
- Later three-stream models fusing RGB, optical flow and pose with attention
- Aktas et al., **90.7%**

High accuracy, but on clips where the stroke has already been located and the player already centred.

### Ball-trajectory only, Kulkarni et al.

Six stroke classes from 2D ball trajectory alone, umpire's-view camera.

- TCN **87.2%**, BiLSTM **83.7%**, LSTM **80.6%** on an unseen player

The physical reasoning is sound: slow strokes separate from fast ones by ball velocity, and topspin bends the trajectory via the Magnus force. But it depends entirely on reliable ball tracking.

### Broadcast-scale, P2ANet

2,721 clips from World Championships and Olympic broadcasts, 14 fine-grained classes annotated by professionals.

- TSM, TSN, Video SwinTransformer and SlowFast all reach only about **82% top-1**

Dense, fast actions against 25 fps broadcast video, where the frame rate itself is a ceiling.

## What they lack

| gap | detail |
|---|---|
| **Trimmed clips, not matches** | The detection problem is assumed away. Nothing tells you *when* strokes happen in continuous video. |
| **Ball dependence** | The trajectory line fails on amateur footage, poor lighting and cluttered halls. |
| **No kinematics output** | All three output a *class label*. A label is not coaching. "That was a loop" tells a player nothing. |
| **No calibrated confidence** | Softmax scores are systematically overconfident. For coaching, a confidently wrong label produces confidently wrong advice, which is worse than silence. |
| **No rally structure** | Stroke classification in isolation ignores that table tennis is played in points. |
| **Unstated capture assumptions** | Accuracy is reported on the authors' own setup, without quantifying what breaks elsewhere. |
| **Validation shortcuts** | Random train/test splits leak strokes from the same rally across the split and inflate results substantially. |

That last point is not hypothetical. **The first attempt in this project hit 81.8% validation accuracy on epoch one with a shuffled split.** It was pure memorisation of strokes from the same rally appearing on both sides. It looked like a good result and was worthless.

## What we do differently

**Continuous video, not clips.** A dedicated contact-detection model runs over the whole video and emits per-frame contact probability. Detection is a first-class problem, trained on 1,457 labelled contacts and evaluated at frame-level tolerance.

**No ball needed.** Everything derives from 17 body keypoints per player, so it works in cluttered halls and poor lighting where ball tracking fails.

**Kinematics as the primary output.** Every shot carries **13 measured quantities**. The class label's job is to select the right *reference distribution* to compare against, not to be the answer.

**Calibrated confidence with per-class abstention.** Temperature scaling fitted on held-out predictions, then a separate threshold per class. Classes that cannot reach the required precision are **suppressed**: counted in statistics, never used for feedback.

**Constraints measured, not assumed.** The frame-rate and camera-angle limits are quantified experimentally.

**Validation done properly.** Seven grouped folds split **by video**, so no stroke from a rally ever appears on both sides.

---

# 3. Plan of action and model stack

## Phased plan

| phase | goal | status |
|---|---|---|
| **1** | Detect *when* a stroke is played and classify it | ✅ complete |
| **2** | End-to-end pipeline: video to rallies and per-shot records | ✅ complete |
| **2.5** | **3D pose, to lift the sideline-camera constraint** | **next** |
| **3** | Coaching layer: technique feedback per shot | ⬜ after 2.5 |

## Data

| source | contents | licence |
|---|---|---|
| **OpenTTGames** (`lab.osai.ai`) | 12 videos, 120 fps, 1920x1080, 35 GB, 89.5 min. Frame-level ball bounces, net hits, coordinates, masks. | CC BY-NC-SA 4.0 |
| **Extended OpenTT Games** (arXiv 2512.19327, DTU Compute, Dec 2025) | Frame-accurate **stroke type**, body lean, leg stance, rally outcomes on the same videos. | CC BY-NC-SA 4.0 |

Yielding **1,457 typed strokes**, 1,432 lean labels, 1,319 feet labels, 282 rally outcomes and 24 player-instances.

> Non-commercial and share-alike. Fine for a project; a shipped product would need owned footage.

## Taxonomy

| class | raw techniques | count | share |
|---|---|---|---|
| **serve** | serve | 290 | 19.9% |
| **attack** | loop, smash, flick | 660 | 45.3% |
| **control** | push | 279 | 19.2% |
| **defence** | block, chop, lob | 228 | 15.6% |

Smash folds into attack because there are **12 smashes in the entire dataset**. As a standalone class the imbalance would be 55:1 and no evaluation of it would mean anything.

## Model stack

| stage | model | notes |
|---|---|---|
| Table and player detection | **custom-trained YOLO** | trained on OpenTTGames frames, two classes: `player`, `table`. 6.2 MB. |
| 2D pose | RTMPose-l, ONNX Runtime with CUDA | 17 COCO keypoints, 16.0 ms per inference on a T4 |
| Contact detection | dilated TCN, PyTorch | 1.17M params, 170 input channels, two heads |
| Stroke classification | dilated TCN with attention pooling | 1.07M params, 86 input channels, two heads |
| Interpretable baseline | LightGBM with SHAP | 44 hand-engineered scalars, used to diagnose rather than deploy |

Training and all experiments ran on Google Colab with a T4.

### The custom detector

The table and player detector is **trained specifically for this project**, not an off-the-shelf person detector. That matters for two reasons.

A generic COCO person detector finds every person in frame, which in a tournament hall means spectators, umpires and players at neighbouring tables. Training on OpenTTGames frames with two classes gives boxes that are already scoped to the match.

The **table** class does real work beyond drawing a rectangle. Its horizontal centre is what separates the two athletes from everyone else: the player box furthest left of centre and the one furthest right are the two competitors. The table edges also provide the reference for `table_distance`, one of the 13 kinematics and the strongest single signal for defensive play. And the detector doubles as a pre-flight check: if no table is found across sampled frames, or both players land on the same side of it, the video is rejected before any GPU time is spent on it.

### Why RTMPose-l on crops rather than whole-frame

Benchmarked against several YOLO-pose configurations. RTMPose-l running top-down on a tight detector crop was **1.8x faster and more accurate on wrists** than the best YOLO configuration tested. Wrists carry most of the discriminative signal for stroke classification, so that accuracy difference mattered more than the speed one.

### Why dilated TCNs rather than the obvious alternatives

**The contact detector keeps full temporal resolution.** A U-Net style encoder-decoder is the obvious architecture for per-frame prediction, but every stride-2 layer blurs peak location, and the model is scored at plus or minus 8 frames. Seven dilated blocks with dilation 1 to 64 reach a receptive field of 2,033 frames without any downsampling.

**The classifier uses attention pooling, not the last hidden state.** Contact sits at the centre of the 97-frame window, at index 60. The first attempt used an LSTM's final hidden state, which forces the decisive moment through 36 steps of decay. Learned attention lets the model read the frames that matter.

## Key decisions

| # | decision | basis |
|---|---|---|
| D1 | 4 classes | matches what pose can observe |
| D2 | **120 fps native** | the acceleration phase is 12 to 18 frames at 120 fps, 3 to 4 at 30 |
| D3 | Window minus 60 to plus 36 (97 frames) | asymmetric, because a block's defining property is the *absence* of backswing |
| D4 | **7 grouped folds by video** | single-video LOVO leaves 4 folds with a class at zero support |
| D5 | Macro-F1, support-weighted | accuracy hides everything on an imbalanced problem |
| D6 | Homography deferred | 10 of 12 videos share a venue; torso normalisation covers it |
| D7 | RTMPose-l on detector crops | 1.8x faster than the best YOLO config and better on wrists |
| D8 | Extract both players | preserved the opponent-context option |
| D9 | Taxonomy unchanged after the baseline | three alternatives tested and rejected |
| D10 | Dilated TCN before PoseC3D | tests the temporal claim directly, no `mmcv` install risk |
| D11 | Auxiliary heads: `technique` at 0.20 only | weight sweep; lean and feet were neutral to harmful |
| D12 | Rally segments of plus or minus 1.5 s, not full continuous | 34% coverage at 2 h instead of 5.7 h |
| D13 | Detection scored at plus or minus 8 frames | measured against downstream need, not chosen a priori |

---

# 4. What has been built

## Pipeline

```
video.mp4
  1  activity gate      both players present and moving, sequential decode
  2  pose               RTMPose-l on custom detector crops, active regions only
  3  canonicalise       hip-centred, torso-scaled, side-mirrored
  4  contact detection  per-frame probability, peaks with NMS
  5  side attribution   which player struck it
  6  classification     4 classes, temperature-calibrated
  7  kinematics         13 scalars per shot
  8  rally grouping     gaps over 1.5 s
  9  render             one annotated video plus a crop track
```

About 5x realtime on a T4. Pose is roughly 80% of it.

## How the metrics are derived

This is the part worth spelling out, because none of these numbers come from a model that was trained to predict them directly.

### Shot detection

The contact detector reads a 170-channel stream: both players, each contributing 34 keypoint coordinates, 34 velocities and 17 confidences. It outputs a per-frame probability that a racket-ball contact occurred.

Training used **soft Gaussian targets** with sigma of 2 frames rather than one-hot labels. A contact is annotated on a single frame, but the source paper notes the exact impact moment is not always captured even at 120 fps, so ground truth carries about plus or minus 1 frame of noise. A hard target punishes a prediction one frame early exactly as hard as one fifty frames early. Gaussian targets also convert an impossibly sparse objective, roughly 1 positive frame in 139, into something trainable without resampling, which would have destroyed the temporal continuity the model depends on.

At inference the probability curve is peak-picked with non-maximum suppression at 30 frames, which is 0.25 s. That is a physical constraint: you cannot strike twice faster than that.

### Player attribution

A second head on the same network trunk. It shares the encoder with contact detection, which turned out to help both: adding the side loss improved detection F1 from 0.853 to 0.881, because representing *who* is striking sharpens *when*.

Accuracy is **0.994**.

### Stroke classification

A 97-frame window is cut around each detected contact, spanning minus 60 to plus 36 frames. The window is asymmetric on purpose: a block's defining property is the absence of a backswing, so the pre-contact portion carries more class information than the follow-through.

The classifier reads 86 channels from the striker only: 34 canonical keypoint coordinates, 34 velocities, 17 validity flags and 1 table distance.

Multi-task training with an auxiliary 8-way technique head at loss weight 0.20. Class-balanced sampling and focal loss handle the 2.9:1 imbalance.

### Rally counting

There is no rally model. Rallies come from **gaps in the detected contact sequence**: more than 1.5 s between contacts starts a new one.

That threshold was **validated against the 282 annotated rally endings** in the dataset rather than picked by eye. Boundary F1 is 0.769, with recall pinned at 0.789 by the detection ceiling, since a rally whose final stroke was never detected cannot have its boundary recovered by any gap parameter. Sweeping the parameter from 0.8 s to 4.0 s moved F1 by less than 0.04, which is a good sign: the method is not balanced on a hand-tuned constant.

Ground truth turned out to be 6.8 shots per rally, and the pipeline produces 6.1. An earlier assumption that real rallies average 3 to 5 shots was wrong, and the data corrected it.

### Kinematics

Thirteen scalars per shot, computed from the canonical pose window rather than predicted by any model:

**Position-derived, valid at any frame rate:** backswing amplitude, contact height relative to the shoulder line, elbow angle at contact, elbow range through the swing, trunk lean, trunk rotation, table distance, stance width, knee flexion.

**Velocity-derived, requiring 60 fps or higher:** peak wrist speed, time to peak relative to contact, follow-through path length, recovery time.

All distances are in torso-lengths, so they are independent of camera distance and player size.

### Confidence calibration

The final classifier trained to a loss of 0.0042 and reported 95.7% mean confidence on data it had memorised, against a true accuracy near 79%. Raw softmax from it is badly overconfident.

A single temperature scalar was fitted on **7-fold out-of-fold predictions**, which are genuinely held out. It came to 2.20, and expected calibration error dropped accordingly.

Then a **separate abstention threshold per class**, fitted on the accuracy-versus-confidence curve of those same held-out predictions. Serve reaches 0.974 precision and needs no gating at all. Attack gates at 0.50. Control and defence never reach a usable precision at any confidence, so they are marked as always abstaining: counted in rally statistics, never used to make a claim.

## Notebooks

Fifteen, each producing files the next consumes. Nothing passes through notebook memory, so any of them runs standalone on a fresh runtime.

| notebook | what it does |
|---|---|
| `00_ingest` | Parses 12 label files into strokes, events and rallies. Applies 4 source-annotation corrections. **Asserts** 1,457 reconciliation before writing. |
| `01_player_registry` | Handedness review. Superseded, since handedness is derived automatically in Stage 2. |
| `02_pose_extraction` | RTMPose-l over 97-frame windows around all 1,457 strokes, both players. Derives handedness from wrist-velocity asymmetry. |
| `03_canonicalize` | Hip-centring, torso scaling, mirroring. Contains the **mirror-invariance gate** that asserts its own sensitivity before testing. |
| `04_baseline` | 44 hand-engineered kinematics into LightGBM, 7-fold CV, SHAP. Produced the block-versus-loop hypothesis. |
| `05_skeleton_model` | Dilated TCN, multi-task heads, auxiliary weight sweep. The main classification result. |
| `06a_continuous_pose` | Continuous pose over rally segments, which a detector needs and windowed extraction cannot provide. |
| `06b_contact_detector` | Contact detection, threshold sweep, miss diagnostic, alignment check. |
| `07_eval_e2e` | Cascades detector into classifier. Answers the tolerance question with data. |
| `08_final_models` | Trains one detector and one classifier on all data. Defines the shot record schema. |
| `09_analyse` | First `analyse(video)` implementation. |
| `10_batch_test` | Multi-video pipeline test and rally validation against the 282 annotations. |
| `11_visualise` | Dashboard, annotated video, shot inspector. |
| `12_pipeline_final` | **The deliverable.** All nine stages, every fix, video in and analysed video out. |
| `13_fps_experiment` | Frame-rate resampling and the 30 fps measurement. |

---

# 5. What has been achieved, and what is next

## Results

All from **7-fold cross-validation split by video**, so no stroke from a rally appears on both sides.

| | result |
|---|---|
| Contact detection | **F1 0.881** at plus or minus 8 frames (67 ms) |
| Side attribution | **0.994** |
| Classification | **macro-F1 0.792** |
| End-to-end | **macro-F1 0.698** |
| Rally boundaries | **F1 0.769**, at the detection ceiling |

### Per class

| class | F1 | held-out precision | coachable |
|---|---|---|---|
| serve | **0.980** | 0.974 | yes |
| attack | **0.822** | 0.857 | yes |
| control | 0.773 | 0.804 | no, suppressed |
| defence | 0.471 | 0.556 | no, suppressed |

**59.7% of shots are coachable at 89.4% precision**, and they are serve and attack, where technique coaching matters most.

### Progression

| | macro-F1 |
|---|---|
| v1 LSTM, invalid because of a shuffled split | 0.818, not comparable |
| Stage 4, LightGBM on 44 scalars | 0.693 |
| Stage 5, dilated TCN, multi-task | **0.792** |
| Stage 7, end-to-end cascade | 0.698 |

Fold variance also fell from plus or minus 0.106 to plus or minus 0.077, meaning the model generalises across players better rather than merely scoring higher.

### On real video

`game_1`: **164 shots detected against 161 ground truth**, a 1.9% overcount, across 29 rallies.

Batch across four videos: mean absolute shot-count error **3.2%**, all within 6%.

**Venue independence.** `test_7` is a different hall with a green wall and red floor, and gave 2.0% error against 3.7% for the main venue.

**Negative control.** `test_5` is the only video the models never saw, and its pose stream carries no contact signal. It found 1 shot of 27. The pipeline stays quiet on bad input rather than inventing contacts.

## Findings

**1. Temporal shape recovers what scalar extrema destroy.** After the baseline, `defence` sat at 0.367. The obvious explanation was class heterogeneity, with block mixed in with chop and lob. **That was tested and rejected:** giving block its own homogeneous class moved it only to 0.416.

The real cause is that block and loop share amplitude, contact height and table distance, and differ in the **shape of the velocity curve over time**. Hand-engineered features are extrema, and extrema are exactly what the two strokes have in common. A dilated TCN over the full window confirmed it:

| technique | scalar | temporal | change |
|---|---|---|---|
| lob | 0.000 | 0.444 | **+0.444** |
| chop | 0.065 | 0.387 | **+0.322** |
| push | 0.724 | 0.864 | +0.140 |
| block | 0.419 | 0.532 | **+0.113** |

**2. The December 2025 lean and feet labels do not help.** A negative result. The prediction was plus 3 to plus 6 points. A four-point weight sweep found everything from 0 to 0.6 total auxiliary weight within plus or minus 0.013 of each other, inside noise. At weight 1.1, above the primary loss, it actively hurt.

**3. The plus or minus 5 frame detection target was mis-specified.** Rather than argue the bar was too strict, it was measured against downstream need: classifier accuracy moves only from 0.805 to 0.792 across tolerances of 3 to 8 frames. Eight frames is the operationally correct tolerance, and detection there is 0.881, not 0.781.

**4. Cascade errors are negatively correlated.** The naive expectation was 0.881 times 0.762, which is 0.671. Measured end-to-end was **0.698**. Contacts the detector misses are disproportionately ones the classifier would have failed anyway.

**5. 30 fps costs 54% of peak wrist speed but only 3.8% of class agreement.** Detection F1 went 0.978 to 0.975, class agreement was 96.2%, and position kinematics were unchanged. The 54% loss was eight times worse than predicted, which located the real timescale: the wrist-speed peak is about **33 ms wide**, which is the wrist snapping through contact rather than the swing itself.

## Known limitations

| | |
|---|---|
| **`defence` 0.471, `control` 0.804** | Not coachable. Traces directly to the scoping decision, since blocks and pushes differ from loops partly in racket angle and spin, which live in the ball. |
| **Sideline camera only** | Side-mirroring, torso normalisation and the swing's projection all assume it. This is what Phase 2.5 addresses. |
| **120 fps for velocity metrics** | 30 fps works for detection, rallies and stroke type; swing-speed metrics are withheld. |
| **Players switching ends** | Not handled. "Left" means whoever is on the left, not a person. Fine within a game, wrong across a match. |
| **`test_5` excluded** | Its pose stream carries no contact signal. Cause undiagnosed. |
| **Never run on unseen footage** | All 12 videos were in the final models' training set. The cross-validation numbers are honest estimates, but the pipeline has not faced a video the models did not learn from. |
| **Licence** | CC BY-NC-SA 4.0, non-commercial, and share-alike is viral. |

## Next: Phase 2.5, 3D pose

**This is the immediate next piece of work.**

### Why it is necessary

Everything currently assumes a sideline camera, and three parts of the pipeline depend on it.

**Side mirroring** flips right-end players so all face the same way. That is meaningless if both players sit at similar horizontal positions in frame.

**Torso normalisation** assumes a roughly side-on body. At other angles the shoulder-to-hip distance foreshortens differently depending on pose, which makes the scale factor pose-dependent rather than constant.

**The discriminative motion projects differently.** The swing is largely a motion *toward the table*. From the side that is a large lateral displacement. From behind it compresses toward the camera, and a 2D projection loses most of it.

That third point is geometry, not a training-data problem. More labelled footage from other angles would not fix it.

### The approach

Lift 2D keypoints to 3D using a monocular lifter such as MotionBERT or VideoPose3D, then canonicalise in a body-centred 3D frame. The representation becomes **view-invariant by construction**: no mirroring rules, no foreshortening, no projection loss.

### Plan

1. Lift the existing OpenTTGames stroke windows to 3D, roughly 3 hours of GPU
2. Rewrite canonicalisation for a body-centred 3D frame, which removes the mirroring logic entirely
3. Retrain the classifier on 3D input and compare against the 0.792 baseline

**Gate:** within about 0.03 of the 2D baseline on sideline video means it generalises, so adopt it. More than about 0.05 worse means monocular depth error is costing too much, so stay 2D and require sideline footage.

### Why test on sideline video first

It answers the view-invariance question **without needing multi-angle footage that does not exist yet**. If 3D holds up on the view that can be measured, that is the best available evidence about views that cannot.

**Risk:** monocular 3D lifting introduces depth error of its own, which may cost accuracy relative to 2D on the very view it was tuned for.

## After that: Phase 3, the coaching layer

The reframing that matters is that for coaching, "that was an attack" is nearly useless. What a coach says is "your backswing was short and your contact point was late", which is kinematics, and the pipeline already produces those.

Steps:

1. Reference distributions per stroke class from the 1,457 labelled strokes
2. Deviation scoring, meaning a z-score per kinematic ranked by magnitude and coachability
3. Language generation with confidence gating
4. Session tracking, for consistency over time

**The most valuable measure needs no external reference at all.** Comparing an amateur against twelve professional matches is questionable and sometimes simply wrong. Comparing a player to *themselves* is always valid. A backswing that varies 31% is actionable regardless of what a professional's looks like.

**Prerequisite:** add `source_fps` to the shot record, or a 30 fps upload gets compared against 120 fps references and every phone-video user is told their swing is slow.

## Also open

**Rally outcomes, the largest unused asset.** 282 annotations across 6 categories, never touched. "You lost 8 of 12 points on your backhand side" is worth more than any stroke count. Serve and receive tracking comes nearly free alongside it, since the first shot of every rally is a serve.

**Player identity across ends.** Needed before any multi-game or session-over-session analysis.

**PoseC3D with NTU-60 pretraining.** The last untested lever for `defence`. At roughly 1,400 samples, pretrained weights typically matter more than architecture.

**Performance.** About 5x realtime, of which roughly 2.4x is engineering overhead, since pose is called per frame rather than batched.

---

# The question this project set out to answer

*How far can you get from body pose alone?*

**Far enough** to find shots at F1 0.881, attribute them at 0.994, structure them into rallies at 0.769, and reliably classify the two stroke families where technique coaching matters most, with serve at 0.980 and attack at 0.822.

**Not far enough** to distinguish a block from a push, because that distinction is not in the body. It is in the racket and the ball.

That boundary is the project's most useful output. It is measured rather than guessed, and it says exactly what the eventual coach can and cannot be trusted to say.
