# Hero assets

Not committed by hand — regenerate them when the footage or the UI changes.

## `rally.mp4` / `rally-poster.jpg`

Four seconds of the demo match, cut from the window where both players are
tracked. Outside 57.0–62.0s one player leaves frame and the skeletons drop out,
which looks broken on a loop.

```bash
curl -o /tmp/game1.mp4 https://pub-366667bd9f864bb384d0bf31bf95da26.r2.dev/game_1_web.mp4

ffmpeg -ss 57.0 -t 4.8 -i /tmp/game1.mp4 \
  -vf "scale=1280:-2,fps=30" -c:v libx264 -crf 30 -preset slow \
  -pix_fmt yuv420p -movflags +faststart -an public/hero/rally.mp4

ffmpeg -ss 57.6 -i /tmp/game1.mp4 -frames:v 1 -vf "scale=1280:-2" \
  -q:v 6 public/hero/rally-poster.jpg
```

## `dashboard.jpg`

A real capture of `/analysis/game_1`, cropped to drop the site header.

Two things make this awkward enough to need `scripts/capture-dashboard.mjs`:

- **The panels refuse to draw below `readyState` 2**, and a fresh seek leaves
  the element at exactly `readyState` 1. Chrome's `--screenshot` flag with
  `--virtual-time-budget` fast-forwards timers while the decode happens in real
  time, so it captured blank panels every time.
- **At `t=0` nobody is detected**, so both crops rest on the table and render
  empty. It has to be seeked into a rally.

```bash
# 1. the full match video will not stream fast enough from R2 for a seek,
#    so serve it locally and point the demo at it
curl -o public/tmp-shot.mp4 https://pub-366667bd9f864bb384d0bf31bf95da26.r2.dev/game_1_web.mp4
#    in src/lib/real-demo.ts, temporarily set R2_VIDEO_URL to "/tmp-shot.mp4"

npm run build && npx serve out -l 4321 &
npm i --no-save puppeteer-core

# 2. 94s is inside rally 6, where the crop track shows both players moving
node scripts/capture-dashboard.mjs http://localhost:4321/analysis/game_1/ /tmp/dash.png 94

# 3. captured at 2x; crop the header and halve it
ffmpeg -i /tmp/dash.png -vf "crop=2880:1408:0:112,scale=1440:-1" -q:v 3 public/hero/dashboard.jpg

# 4. put R2_VIDEO_URL back and delete public/tmp-shot.mp4
```
