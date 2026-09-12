/**
 * Recapture public/hero/dashboard.jpg from the real analysis screen.
 *
 * Not part of any build — run it when the analysis UI changes, or the
 * screenshot on the landing page quietly starts lying.
 *
 *   npm i --no-save puppeteer-core      # drives the Chrome already installed
 *   npm run build && npx serve out -l 4321 &
 *   node scripts/capture-dashboard.mjs http://localhost:4321/analysis/game_1/ /tmp/dash.png 94
 *
 * Two things make this fiddly enough to be worth a script:
 *
 *  - The player panels refuse to draw below readyState 2, and a fresh seek
 *    leaves the element at exactly readyState 1. Chrome's --screenshot flag
 *    with --virtual-time-budget fast-forwards timers while the decode happens
 *    in real time, so it always captured empty panels. This waits for a frame
 *    to genuinely exist.
 *  - At t=0 nobody is detected, so both crops rest on the table and the panels
 *    render blank. Seek into a rally: 94s is mid rally 6, where the crop track
 *    shows both players moving.
 */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , url, out, seekTo = "94"] = process.argv;
const target = Number(seekTo);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 760, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });

  await page.waitForFunction(() => !!document.querySelector("video")?.duration, {
    timeout: 60000,
  });
  await page.evaluate((t) => {
    const v = document.querySelector("video");
    v.currentTime = t;
    return v.play();
  }, target);

  await page.waitForFunction(
    (t) => {
      const v = document.querySelector("video");
      return v && v.readyState >= 2 && Math.abs(v.currentTime - t) < 1.5;
    },
    { timeout: 60000, polling: 100 },
    target,
  );

  // Let each panel's frame callback fire, then hold the frame still.
  await new Promise((r) => setTimeout(r, 1500));

  const state = await page.evaluate(() => {
    const v = document.querySelector("video");
    v.pause();
    const c = document.querySelector("canvas");
    const g = c.getContext("2d");
    const px = g.getImageData((c.width / 2) | 0, (c.height / 2) | 0, 1, 1).data;
    return {
      readyState: v.readyState,
      t: +v.currentTime.toFixed(2),
      panelPainted: px[3] !== 0,
    };
  });
  console.log(
    `readyState ${state.readyState} · t=${state.t}s · player panels painted: ${state.panelPainted}`,
  );
  if (!state.panelPainted) {
    console.warn("WARNING: the panels are still blank; pick a time inside a rally.");
  }

  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: out });
} finally {
  await browser.close();
}
