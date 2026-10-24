# Performance notes

## Milestone 1 (2026-10-23)

Target from the spec: 60 fps on a mid-range laptop with integrated graphics at 1080p, first load under 30 MB.

## Measured

| Metric | Value |
|---|---|
| Production download | 3.5 MB total (JS bundle incl. Rapier WASM ~2.4 MB, district.json 0.72 MB / 0.18 MB gzipped) |
| Draw calls per frame, chase view | 45 main pass, plus 3 mirror passes every other frame |
| Triangles, main pass | ~385k |
| Machine used | Apple M5 (ANGLE Metal) |

Load size passes with a wide margin.

## Not measured

Real frame rate. The in-app browser pane was hidden during the build, so `requestAnimationFrame` was throttled and the FPS counter read 2. A GPU timing loop with `gl.finish()` reported 0.2 ms per frame, which Metal does not honour reliably. Both numbers are meaningless, so neither is reported as a result.

To check: run `npm run build && npx vite preview`, open `http://localhost:4173/?debug` in Chrome on an integrated-graphics laptop at 1080p, drive the ring road for two minutes and read the fps counter.

## Changes made for performance

- Traffic lights moved from 5 meshes each (82 signals, ~410 draw calls) to 5 instanced meshes in total, which cut a chase-view frame from ~325 to 45 draw calls.
- Mirrors render at half frame rate into 256×128 targets without updating shadow maps.

## If the laptop check misses 60 fps

In order: shadow map 2048 → 1024 and a smaller shadow frustum, tree crowns to a lower-poly mesh (they are most of the 385k triangles), mirror targets to 128×64.

## Milestone 2 (2026-10-23)

Load: 60 AI cars, 120 pedestrians (40 crossers, 80 walkers), 105 signal controllers, tashkent-center. Budgets: main pass at most M1's 45 draw calls + 15, sim step under 2 ms, download size well under the 30 MB cap.

### Measured

| Metric | Value | Budget | Source |
|---|---|---|---|
| Draw calls, chase view, main pass only | 56 (M1: 45) | 60 | Production build via `vite preview`, `renderer.render` called once with `renderer.info` reset |
| Triangles, main pass | ~487k (M1: ~385k) | none | same |
| Sim step, `traffic.step` + `peds.step`, headless | mean 0.17 to 0.24 ms, p99 0.27 to 0.42 ms per step; single-step max 2.1 to 3.1 ms | 2 ms | `npm run bench:sim` (`tools/bench/sim.ts`), see below |
| Production download | 3.62 MB raw: JS 2.79 MB (0.97 MB gzipped), district.json 0.83 MB (0.20 MB gzipped), css and html under 2 KB | 30 MB | `npm run build`, file sizes summed from `dist/` |

Headless sim budget passes (mean and p99 are far under 2 ms); in-browser sim time was not measured. Draw calls and download size pass. None of the cuts (walkers to 60, cars to 40, lookahead 80 to 60 m) were applied.

### Sim benchmark method and limits

`npm run bench:sim` runs 7,200 fixed steps (1/60 s) of 60 cars and 40 crossers + 80 walkers on the real `district.json`, skips the first 300, and prints mean, p99 and max of `traffic.step` + `peds.step` per step. Two runs: the player parked at the spawn point, and the player driven along a roughly 1.4 km lane path at 12 m/s so cars follow and yield to it. Three consecutive runs gave parked mean 0.17 to 0.24 ms and driving mean 0.17 to 0.19 ms, with the run-to-run spread coming from machine noise.

Limits: Node only, no rendering, no browser, no physics step, no view updates. The player follows a scripted path and never collides or brakes, so player-triggered edge cases are not covered. Single-step maxes of 2 to 3 ms appear in every run (likely JIT or garbage collection) and would show as an occasional dropped frame, which has not been checked in a browser.

### Reading the HUD draw-call number

The `?debug` panel shows `renderer.info.render.calls` for the whole frame, which also counts the shadow pass and the mirror passes. In the browser it read 166 at the spawn point. That is not comparable to M1's 45, which was the main pass alone. Use 56 for the comparison.

### Not measured

- Real frame rate. The in-app browser pane was throttled again (the panel read 1 fps), so no FPS is reported. The laptop check from M1 still applies: `npm run build && npx vite preview`, open `/?debug` on an integrated-graphics laptop at 1080p, drive for two minutes and read fps.
- In-browser sim time (`sim` in the debug panel). The new `sim` figure in the debug panel (1 second average of `traffic.step` + `peds.step` per fixed step) read 0.93 ms in the throttled pane, which includes cold JIT and throttling, so it is not used. Re-check it on the laptop.

### If the laptop check misses 60 fps

M1's order still applies (shadow map size, tree crown triangles, mirror targets). Headless sim cost is small next to a 16.7 ms frame, but the in-browser figure is unmeasured; if the laptop check misses, cut walkers to 60, then cars to 40, then lookahead 80 to 60 m.

## Milestone 4a

### Baseline (before M4a)

Production build via `vite preview`, `/?debug`, free drive, chase view, 20 s at the spawn. The debug panel now shows cpu and gpu p50/p95 over the last 300 frames, plus main-pass draw calls and triangles (the `renderer.render(scene, camera)` call alone, shadow pass included, mirror target passes excluded).

| Metric | Value |
|---|---|
| cpu p50 / p95 | 11.1 / 29.3 ms |
| gpu p50 / p95 | 7.1 / 9.4 ms |
| Main-pass draw calls | 61 |
| Main-pass triangles | ~493k |
| Draw calls, all passes | 64 |

CPU is the loop body's own work time (`performance.now()` around the whole `setAnimationLoop` callback); GPU is an `EXT_disjoint_timer_query_webgl2` query around the mirror passes and the main pass, with disjoint results discarded. GPU time does not depend on the frame interval; CPU time includes up to 5 fixed sim steps when frames are long (`MAX_STEPS` in `src/physics/loop.ts`), so a throttled pane overstates it.

Limits: the in-app browser pane was hidden and throttled to about 1 fps, so the window held roughly 20 frames, not 300, and cpu p95 is a few samples (cold JIT included). Treat cpu as indicative; gpu is steadier. Re-run on the laptop for numbers to budget against. Main-pass calls read 61 against M2's 56 for the same view.

### Budget check (Task 7, 2026-10-24)

Budgets: high at most 8 ms cpu and gpu p95, 120 main-pass draw calls, 1.5 M triangles; low at most half (4 ms, 4 ms, 60, 750k).

Method. Production build (`npm run build && npx vite preview --port 4173`), Playwright Chromium (Chrome 155) on Apple M5, ANGLE Metal, a visible window running at about 120 Hz, viewport 1280x720 CSS at device pixel ratio 2 (so high renders 2560x1440, medium 1920x1080, low 1280x720). Each preset is loaded fresh from `avtomaktab.quality`; time of day set with `env.setTimeOfDay`. Per view: 1.5 s warm-up, then every frame for 3.5 s (parked views, about 420 frames) or 28.5 s (drive, about 3,400 frames). The drive teleports the car along `session.routeLine` from the route-1 start at 12 m/s with `car.reset` each frame, so the camera moves like a real drive but the physics does no driving work. Samples come from `window.__game.lastFrame`, filled every frame by `main.ts`:

- render cpu: `env.follow` through `gpuTimer.end`, mirrors and the main pass included;
- sim and other cpu: whole loop body minus render (sim steps, view updates, minimap, HUD);
- gpu: `EXT_disjoint_timer_query_webgl2` around mirrors and the main pass;
- steps: fixed 60 Hz sim steps run that frame. At 120 Hz the mean was 0.5 and the max 1 in every run, so no catch-up steps inflate cpu here.

Two earlier runs in the same session are discarded: one wrote the wrong localStorage key (every preset ran as medium), one ran at pixel ratio 1.

| Preset | Time | View | render cpu p50 / p95 | sim+other cpu p50 / p95 | gpu p50 / p95 | main-pass calls | main-pass triangles |
|---|---|---|---|---|---|---|---|
| low | noon | chase, spawn | 0.6 / 1.5 | 0.6 / 2.3 | 2.1 / 5.1 | 62 | 493k |
| low | noon | cockpit, spawn | 0.5 / 1.4 | 0.5 / 2.5 | 2.3 / 5.0 | 46 | 492k |
| low | noon | chase, route-1 drive | 0.6 / 1.5 | 0.7 / 2.6 | 2.0 / 4.7 | 62 | 493k |
| low | evening | chase, spawn | 0.6 / 1.4 | 0.6 / 2.5 | 2.3 / 4.7 | 62 | 493k |
| low | evening | cockpit, spawn | 0.5 / 1.5 | 0.9 / 2.7 | 2.3 / 5.1 | 46 | 492k |
| low | evening | chase, route-1 drive | 0.6 / 1.5 | 0.7 / 2.4 | 2.0 / 4.7 | 62 | 493k |
| medium | noon | chase, spawn | 0.8 / 1.8 | 0.5 / 2.0 | 3.9 / 5.5 | 73 | 598k |
| medium | noon | cockpit, spawn | 0.7 / 1.6 | 0.6 / 2.2 | 4.2 / 5.0 | 54 | 597k |
| medium | noon | chase, route-1 drive | 0.8 / 1.7 | 0.6 / 2.2 | 3.7 / 5.5 | 73 | 598k |
| medium | evening | chase, spawn | 0.7 / 1.7 | 0.6 / 2.1 | 4.3 / 4.9 | 73 | 598k |
| medium | evening | cockpit, spawn | 0.7 / 1.7 | 0.8 / 2.1 | 3.6 / 5.7 | 54 | 597k |
| medium | evening | chase, route-1 drive | 0.8 / 1.8 | 0.6 / 2.1 | 3.8 / 5.2 | 73 | 598k |
| high | noon | chase, spawn | 0.7 / 1.6 | 0.6 / 1.8 | 4.2 / 5.4 | 84 | 703k |
| high | noon | cockpit, spawn | 0.7 / 1.5 | 0.5 / 1.9 | 4.3 / 4.9 | 62 | 703k |
| high | noon | chase, route-1 drive | 0.8 / 1.7 | 0.6 / 2.1 | 3.9 / 5.2 | 84 | 703k |
| high | evening | chase, spawn | 0.7 / 1.6 | 0.5 / 2.0 | 4.6 / 4.9 | 84 | 703k |
| high | evening | cockpit, spawn | 0.7 / 1.6 | 0.6 / 2.0 | 4.4 / 5.2 | 62 | 703k |
| high | evening | chase, route-1 drive | 0.8 / 1.8 | 0.6 / 2.0 | 4.0 / 5.1 | 84 | 703k |

All times in ms. Calls and triangles did not change at all within a view (p50 equals max), because every world mesh is merged or instanced over the whole district and is never frustum culled.

Result:

- High passes on every axis: worst gpu p95 5.4 ms, render cpu p95 1.8 ms (whole loop p95 under 3 ms), 84 calls, 703k triangles.
- Low passes render cpu (1.5 ms) and triangles (493k), and misses gpu p95 (4.7 to 5.1 ms against 4) and chase-view calls (62 against 60; cockpit is 46).

The Task 1 baseline (gpu 7.1 / 9.4 ms) and the Task 5 figure (11.2 / 13.7 ms) were taken in the hidden, throttled browser pane. Unthrottled, the same scene measures about half of that, so neither is a reference for the budget.

### Tuning (Task 7)

No values changed. The planned order was tiling the merged buildings and tree instances into ~150 to 200 m chunks, then shadow far 300 on high, then `PCFShadowMap`, then cascades, map size, pixel ratio and mirror cadence. Each step is conditional on a miss, and high has none. Tiling was also checked against the scene and would not pay for itself here: the six building meshes total about 14k triangles, so culling them saves little, while splitting them and the trees into chunks adds a draw call per visible chunk to a count that low already exceeds. Most triangles are the 4,538 instanced trees (44 each, about 200k in the main pass plus 91k per shadow cascade); tiling those is the first move if high ever misses on a slower machine.

Low's two misses, diagnosed on low chase at noon:

| Change (live, low chase, noon) | gpu p50 / p95 |
|---|---|
| as shipped (mirrors every 3rd frame) | 2.2 / 5.4 |
| mirrors every frame | 3.1 / 5.0 |
| mirrors off | 2.7 / 5.6 |
| shadow map updates off | 2.0 / 4.0 |
| mirrors off, shadow updates off, pixel ratio 0.25 | 1.0 / 3.4 |

Mirror cadence does not move p95, and a near-empty frame still has a p95 of 3.4 ms with single-frame spikes to about 4 ms, so the timer has a noise floor on this machine close to low's 4 ms budget. The shadow map update is the one real cost (about 1.4 ms at p95). Low already has 1 cascade at 1024, pixel ratio 1 and mirrors every 3rd frame, so the brief's levers are spent; dropping low's shadows or going to a 512 map would change how low looks, which is a feature cut and is left for a decision. Low's 62 calls are the M3 count (61) plus the M4a sky; getting to 60 needs merging meshes (the player car alone is 15 draw calls), not value tuning.

### Download size

| Part | Bytes |
|---|---|
| JS bundle (incl. Rapier WASM) | 2,907,624 (1.0 MB gzipped) |
| district.json | 846,822 |
| Textures (all M4a) | 3,109,935 |
| Audio | 1,052,784 |
| Total `dist/` | 7,917,636 |

The M4a texture share is 3.11 MB against the 4 MB cap; all five texture sets are in `CREDITS.md`.
