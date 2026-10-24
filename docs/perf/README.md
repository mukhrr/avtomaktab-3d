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
