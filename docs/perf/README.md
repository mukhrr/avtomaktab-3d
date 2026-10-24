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
- Low, against half of high, passes render cpu (1.5 ms) and triangles (493k) and misses gpu p95 (4.7 to 5.1 ms against 4) and chase-view calls (62 against 60). Under the ruling below it is judged against M3 instead.

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

Mirror cadence does not move p95, and a near-empty frame still has a p95 of 3.4 ms with single-frame spikes to about 4 ms, so the timer has a noise floor on this machine close to low's 4 ms budget. The shadow map update is the one real cost (about 1.4 ms at p95). Low already has 1 cascade at 1024, pixel ratio 1 and mirrors every 3rd frame, so no tuning is applied. Low's 62 calls are the M3 count (61) plus the M4a sky.

Ruling (controller, 2026-10-24): low is judged against the pre-M4a cost, M3's 61 main-pass calls plus 1 sky call, not against half of high. The timer's noise floor of about 3.4 ms p95 on the M5 makes half of high's 8 ms unmeasurable, and low is meant to look and cost like M3. Against that, low passes on calls (62). M3's own unthrottled GPU time was not measured: `main` has no GPU timer and no presets, so there is no like-for-like low figure to compare with.

### Download size

| Part | Bytes |
|---|---|
| JS bundle (incl. Rapier WASM) | 2,907,624 (1.0 MB gzipped) |
| district.json | 846,822 |
| Textures (all M4a) | 3,109,935 |
| Audio | 1,052,784 |
| Total `dist/` | 7,917,636 |

The M4a texture share is 3.11 MB against the 4 MB cap; all five texture sets are in `CREDITS.md`.

### Fix round 1: sky ambient light (2026-10-24)

Buildings and trees moved from Lambert to `MeshStandardMaterial` (roughness 1) so they take image-based ambient light from `scene.environment`, a PMREM of the current sky built on each `setTimeOfDay` (old target disposed). Times of day retuned; the visible sky got a saturation and gain uniform so it stays blue at any exposure.

PMREM rebuild: 2.0 to 3.0 ms CPU per time-of-day change including `gl.finish` (5 calls), once per Start press, never per frame.

Same method as above, low and high, noon and evening, drive shortened to 15 s:

| Preset | View | render cpu p95 | gpu p50 / p95 | calls | triangles |
|---|---|---|---|---|---|
| high | chase, spawn | 1.3 | 5.4 / 5.7 (evening 6.3) | 84 | 703k |
| high | cockpit, spawn | 1.4 | 5.3 / 5.5 (evening 6.3) | 62 | 703k |
| high | route-1 drive | 1.7 to 1.8 | 4.2 to 4.3 / 5.1 to 5.2 | 84 | 703k |
| low | chase, spawn | 1.6 | 2.5 to 2.6 / 4.9 to 5.5 | 62 | 493k |
| low | cockpit, spawn | 1.5 | 2.3 to 2.4 / 4.6 to 5.6 | 46 | 492k |
| low | route-1 drive | 1.6 to 1.7 | 2.2 to 2.3 / 4.9 to 5.0 | 62 | 493k |

High gpu p50 rose about 1 ms (Standard shading and the environment lookup on every building and tree) and stays within 8 ms at p95. Calls and triangles are unchanged. Low rose about 0.3 ms at p50.

### Fix round 2: sky ambient on every lit material, low stays M3 (2026-10-24)

`QualitySettings.skyAmbient` (false on low, true on medium and high) is fixed at page load like ground textures. With it, main builds the PMREM and `useSkyAmbient` (`src/render/litMaterials.ts`) swaps every Lambert material in the scene (buildings, trees, AI cars, pedestrians, signals, signs, water, the player car's tyres and rims) for a matte `MeshStandardMaterial` with the same colour, so all of them take the sky ambient. Without it nothing is swapped, no PMREM is built, and the hemisphere light uses the preset's `hemiWithoutSky` (noon 4, morning 4, evening 3.5), the only fill light low has, as in M3. The player car's paint and glass were Standard already in M3 and stay so on low.

One caveat: the preset is fixed per load, so when the first-visit probe picks low at runtime, that visit keeps medium's materials until the next load.

Perf recheck, DPR 2, unthrottled:

| Preset | gpu p50 / p95 | render cpu p95 | calls | triangles | `scene.environment` |
|---|---|---|---|---|---|
| high (noon, evening; chase, cockpit, drive) | 3.9 to 5.2 / 4.9 to 6.5 | 0.7 to 1.7 | 84 chase / 62 cockpit | 703k | set |
| low (same views) | 1.5 to 2.3 / 3.9 to 5.4 | 1.6 to 1.8 | 62 / 46 | 493k | null |

A first high run read 13 to 27 ms gpu from the noon drive onward while other Chrome windows were busy on the same GPU; an immediate rerun gave the figures above, so that run is discarded.

## Milestone 4b

### Budget check (Task 7, 2026-10-24)

Budgets: high at most 8 ms gpu and render cpu p95 in the chase view, 120 main-pass draw calls, 1.5 M triangles. Low at most +10 calls and +20% gpu p50 over its cost before M4b.

Method as in M4a: production builds served by `vite preview`, Playwright Chromium (Chrome for Testing, build 1243) on Apple M5 in a visible window at about 120 Hz, 1280x720 CSS at pixel ratio 2, preset from `avtomaktab.quality`, time of day from `env.setTimeOfDay`, samples from `window.__game.lastFrame` every frame after a 1.5 s warm-up (3.5 s parked, 28.5 s for the route-1 drive, which teleports the car along `session.routeLine` at 12 m/s). Steps per frame were mean 0.5, max 1 in every run.

"Before" is `main` at f8ba7db (M4a merge plus the M4b plan), built and served from a scratch worktree on the same machine in the same session, so both sides share the same browser, window and GPU state. High ran twice per side, low four times, interleaved (main, branch, branch, main, then main, branch, main, branch). Cells give the range over runs.

High:

| Time | View | render cpu p50 / p95 | gpu p50 / p95 | calls | triangles | gpu p50 / p95 before |
|---|---|---|---|---|---|---|
| noon | chase, spawn | 0.5 to 0.7 / 0.8 to 1.4 | 6.6 to 7.0 / 7.6 | 83 | 615k | 5.4 to 5.6 / 6.3 |
| noon | cockpit, spawn | 0.5 to 0.6 / 0.8 to 1.0 | 5.8 to 5.9 / 6.4 to 6.6 | 61 | 613k | 5.3 / 6.1 to 6.2 |
| noon | route-1 drive | 0.6 to 0.8 / 1.0 to 1.3 | 5.7 to 6.0 / 6.6 to 7.0 | 83 | 626k (max 634k) | 4.4 to 4.6 / 5.4 to 5.5 |
| evening | chase, spawn | 0.5 to 0.9 / 0.8 to 1.3 | 5.8 to 6.6 / 6.5 to 7.2 | 83 | 630k | 4.5 to 4.7 / 5.5 to 5.6 |
| evening | cockpit, spawn | 0.7 / 1.1 to 1.4 | 4.9 to 5.1 / 5.8 to 5.9 | 61 | 634k | 4.1 to 4.4 / 5.2 |
| evening | route-1 drive | 0.6 to 0.8 / 1.1 to 1.3 | 5.6 to 6.1 / 6.5 to 7.1 | 83 | 659k (max 691k) | 4.1 to 4.6 / 5.4 |

Before M4b, high drew 84 / 62 calls and 703k triangles in every view.

Low:

| Time | View | gpu p50 before, mean of 4 | gpu p50 after, mean of 4 | change | gpu p95 after | render cpu p95 after | calls before / after | triangles before / after |
|---|---|---|---|---|---|---|---|---|
| noon | chase, spawn | 1.98 | 2.00 | +1% | 4.2 to 5.3 | 1.5 to 1.8 | 62 / 63 | 493k / 374k |
| noon | cockpit, spawn | 1.95 | 1.93 | -1% | 4.2 to 5.2 | 1.6 to 1.7 | 46 / 47 | 492k / 374k |
| noon | route-1 drive | 1.80 | 1.90 | +6% | 4.1 to 4.9 | 1.6 to 1.7 | 62 / 63 | 493k / 381k (max 395k) |
| evening | chase, spawn | 1.93 | 2.05 | +6% | 4.2 to 6.2 | 1.7 | 62 / 63 | 493k / 384k |
| evening | cockpit, spawn | 1.75 | 1.93 | +10% | 4.1 to 5.9 | 1.5 to 1.6 | 46 / 47 | 492k / 384k |
| evening | route-1 drive | 1.85 | 1.98 | +7% | 4.4 to 4.9 | 1.7 to 1.8 | 62 / 63 | 493k / 396k (max 403k) |

All times in ms.

Result:

- High passes every axis. Worst gpu p95 is 7.6 ms (noon chase, both runs; 7.7 in a separate diagnostic run), so the margin is 0.3 to 0.4 ms. Worst render cpu p95 1.4 ms, 83 calls, 691k triangles. High gpu p50 rose 0.5 to 1.6 ms over M4a (most in chase and drive); calls fell by one because the chunked BatchedMesh walls, roofs and trees replace the merged M4a meshes, which offsets the new lamps, aryks and furniture.
- Low passes: +1 call (63 against 72 allowed), and the mean gpu p50 rose 1% to 10% per view against 20% allowed. Triangles fell about 110k because chunks out of view are culled. The worst single pairing is the fourth branch run in the evening, chase 2.5 against 2.0 (+25%) and cockpit 2.3 against 1.8 (+28%). That run's p95 also jumped to 6.2 and 5.9 while its noon views were normal, so it reads as a disturbance, and a 0.3 ms swing on a 1.8 ms base is inside the timer noise noted in M4a.

### Tuning (Task 7)

No values changed: high and low both pass, so the planned order (chunk size, roof boxes, lamp spacing on low, aryks off on low) was not started.

Where high's gpu time goes, live, high chase at noon, hiding mesh groups in one page (single run, 4.5 s each):

| Hidden | gpu p50 / p95 | calls | triangles |
|---|---|---|---|
| nothing | 6.5 / 7.7 | 83 | 615k |
| facade walls (textured BatchedMesh) | 6.1 / 7.0 | 79 | 595k |
| every vertex-coloured BatchedMesh (roofs, per-chunk trees, streetside batches) | 5.6 / 6.1 | 74 | 356k |
| every BatchedMesh | 4.5 / 5.2 | 70 | 336k |
| every InstancedMesh (lamps, furniture, signals, signs, cars, pedestrians) | 6.6 / 7.6 | 46 | 318k |

The batched world costs about 2 ms of high's gpu p50, most of it in the vertex-coloured batches that carry the trees. Instanced meshes cost calls but almost no gpu time here. If high misses on a busier GPU, chunk size is the first step: smaller chunks cull more of the tree and roof batches behind the camera.

### Download size

| Part | Before M4b (main) | After |
|---|---|---|
| JS bundle (incl. Rapier WASM) | 2,904,439 | 2,939,521 (1,020,150 gzipped) |
| district.json | 838,301 | 856,510 |
| Textures | 3,109,935 | 3,109,935 |
| Audio and the rest | 1,066,659 | 1,066,659 |
| Total `dist/` | 7,919,334 | 7,972,625 |

M4b adds 53 KB (code and the style, level and furniture fields in `district.json`) and no downloaded assets; facades and furniture are drawn in code, so `CREDITS.md` is unchanged.

### World build time

Spec: world generation under 2 s. `aryks()` (~107 ms) and `lampPositions()` (~124 ms) used to run 2 to 3 times each (render, physics, and lamps recomputing aryks); both are now computed once per district object.

Method: Vite dev server, in-app Chrome on an Apple M5, a fresh `district.json` fetch per run, `createFacadeTexture()` + `buildWorld()` + `createPhysics()` timed with `performance.now()` (Rapier already initialised, ground materials stubbed so no texture downloads). Four runs each, unminified dev modules.

| | build | physics | total |
|---|---|---|---|
| before | 2.19 to 2.39 s | 0.74 to 0.84 s | 2.9 to 3.2 s |
| after | 1.80 to 1.98 s | 0.03 to 0.09 s | 1.9 to 2.1 s |

The machine was noisy: one extra before-run read 0.7 s total and one after-run 0.2 s, both discarded as outliers. Production build is faster than dev modules but was not timed separately.
