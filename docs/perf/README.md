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
| Sim step, `traffic.step` + `peds.step` | mean 0.23 ms, p99 0.46 ms, max 4.3 ms (one outlier in 7,000 steps) | 2 ms | Headless `tsx` script on the real district.json, 60 cars + 120 peds, 7,000 steps at 1/60 s, first 300 skipped. Traffic alone mean 0.11 ms, peds alone mean 0.12 ms |
| Production download | 3.62 MB raw: JS 2.79 MB (0.97 MB gzipped), district.json 0.83 MB (0.20 MB gzipped), css and html under 2 KB | 30 MB | `npm run build`, file sizes summed from `dist/` |

All budgets pass, so none of the cuts (walkers to 60, cars to 40, lookahead 80 to 60 m) were applied.

### Reading the HUD draw-call number

The `?debug` panel shows `renderer.info.render.calls` for the whole frame, which also counts the shadow pass and the mirror passes. In the browser it read 166 at the spawn point. That is not comparable to M1's 45, which was the main pass alone. Use 56 for the comparison.

### Not measured

- Real frame rate. The in-app browser pane was throttled again (the panel read 1 fps), so no FPS is reported. The laptop check from M1 still applies: `npm run build && npx vite preview`, open `/?debug` on an integrated-graphics laptop at 1080p, drive for two minutes and read fps.
- In-browser sim time. The new `sim` figure in the debug panel (1 second average of `traffic.step` + `peds.step` per fixed step) read 0.93 ms in the throttled pane, which includes cold JIT and throttling, so it is not used. The headless numbers above are the ones to trust until the laptop check.

### If the laptop check misses 60 fps

M1's order still applies (shadow map size, tree crown triangles, mirror targets). Sim cost is not the bottleneck at 0.23 ms; if needed, cut walkers to 60, then cars to 40, then lookahead 80 to 60 m.
