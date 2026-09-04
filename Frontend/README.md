# PongAI — Frontend

Web interface for a table-tennis video analysis system that works from **body pose only** — it never tracks the ball. Built against `../PONGAI_FRONTEND_SPEC.md`; that document is the source of truth for every design and product decision here.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

| script | what it does |
| --- | --- |
| `npm run dev` | dev server (Turbopack) |
| `npm run build` | production build |
| `npm run start` | serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run format` | Prettier (with Tailwind class sorting) |

> If `typecheck` complains that a route type is missing, run `npx next typegen` — Next generates `PageProps` / `LayoutProps` types from the file system, and a newly added route needs one pass first.

## Layout

```
src/
  app/                     routes (App Router)
    globals.css            the design system — tokens, type scale, base styles
    layout.tsx             root layout, metadata, global chrome
    page.tsx               home (spec §5.1)
    analysis/[id]/         the analysis view (spec §5.2) — placeholder for now
  components/              shared UI
  lib/
    types.ts               the backend data contract (spec §3)
    constants.ts           pose geometry, kinematic groups, class reliability
```

## The rules that shape the code

These are not stylistic preferences — each one exists because the measured behaviour of the model demands it. Read spec §4 and §7 before changing anything they touch.

1. **Brand orange is a fill, never text on the background.** `#f55f02` on `#e6e0dc` is 2.46:1 and fails WCAG AA. Use `text-brand-text` (`#a63e02`, 4.85:1) when an orange-looking text colour is needed. Buttons are orange with **black** text.
2. **Uncertain shots must look uncertain.** `control` and `defence` labels are 80% and 56% precise. Anything with `abstain === true` renders with the `hatch-uncertain` pattern and reduced opacity, and never feeds a headline claim.
3. **Velocity kinematics are absent below 60fps, not greyed.** At 30fps the wrist-speed peak is under-measured by ~54%. Gate on `isVelocityReliable(source_fps)` and exclude those fields from every chart and comparison.
4. **Overlays are drawn in the browser**, on a `<canvas>` over the `<video>` — never a server-rendered annotated video (~30 min and ~84 MB per match, and it cannot be scrubbed or toggled).
5. **Colour never carries meaning alone.** Every shot marker also carries its `S` / `A` / `C` / `D` letter.

Only six type sizes exist (12/14/16/20/28/40); Tailwind's default scale is reset in `globals.css` so an out-of-scale size fails loudly rather than silently.

## Build order

Per spec §10. Current position: **step 1**.

1. ✅ App scaffold, design system, data contract, home screen
2. ⬜ Demo JSON fixtures + MP4s at `public/demo/{id}.json`
3. ⬜ Video player + `<ShotTimeline />` — click a shot, video seeks
4. ⬜ `<VideoOverlay />` — canvas skeleton and shot flashes
5. ⬜ `<ShotDetail />` with the uncertainty rules
6. ⬜ `<MatchSummary />` + `<PlayerCard />`
7. ⬜ `<KinematicsChart />`
8. ⬜ Upload — once there is a backend worth calling
