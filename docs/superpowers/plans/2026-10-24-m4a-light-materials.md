# M4a Light and Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the district a real sky, three times of day, sharper and longer-reaching shadows, textured ground surfaces and quality presets, within a measured frame budget.

**Architecture:** Pure modules decide what to draw (`src/render/sun.ts` for sun position, `src/render/timeOfDay.ts` for light presets, `src/render/quality.ts` for presets and their storage, `src/render/frameStats.ts` for timing). `src/world/environment.ts` becomes the lighting rig that applies a time of day and a quality preset to the scene (three.js `Sky`, sun, hemisphere light, fog, exposure, `CSM` cascaded shadows). Ground meshes get world-space UVs and CC0 textures. The start screen gains time-of-day and quality pickers.

**Tech Stack:** TypeScript 5.6, three 0.169.0 (`three/addons/objects/Sky.js`, `three/addons/csm/CSM.js`), React 18 HUD, Vitest 2.1.

**Spec:** `docs/superpowers/specs/2026-10-24-m4-realism-design.md` (parent: `docs/superpowers/specs/2026-10-23-avtomaktab-3d-design.md`).

## Global Constraints

- Free assets only (CC0 or CC-BY), each recorded in `CREDITS.md` with author, licence and source URL.
- M4 asset download budget 10 MB in total; M4a may use at most 4 MB of it.
- Reference machine: Mukher's Mac (Apple M5, Chrome). High preset at most 8 ms frame time (CPU and GPU each) in the chase view, at most 120 draw calls and 1.5 million triangles in the main pass; low preset at most half of each.
- Realism work must not change anything the rules read: no change to road geometry, lane data, physics or traffic boxes.
- All UI text from `src/i18n/uz.json` and `src/i18n/ru.json` (Uzbek Latin with plain apostrophe). No em or en dashes anywhere.
- localStorage access wrapped in try/catch; the game works without it.
- Code comments only for what the code cannot say.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Mirrors with cascaded shadows.** The mirror cameras render the same scene with materials patched by `CSM` for the main camera. Expected: mirrors show the street lit and shadowed plausibly, with no black or striped surfaces. Task 5 checks this in its browser step.
2. **Cockpit view near the car.** The nearest cascade must not show shadow acne or a dark band on the dashboard, bonnet or the road just ahead. Task 5 checks this in its browser step.
3. **Evening low sun.** Long shadows reach past a single 240 m frustum. Expected: no shadow pops at cascade edges within 150 m of the car while driving at 50 km/h. Task 5 checks this in its browser step.
4. **Sky with the logarithmic depth buffer and a 3000 m far plane.** `Sky` writes `z = w` and is usually scaled to 450,000 units. Expected: the sky draws behind everything with no clipped box edges or holes, in every camera, including the mirrors. Task 5 has a unit test that the sky's scale fits inside the camera far plane, plus a browser check.
5. **Changing preset or time of day between drives.** Expected: no reload is needed except for antialiasing, no GPU memory grows across ten switches, and shadow maps are disposed when their size changes. Task 6 tests the dispose logic headlessly.

---

### Task 1: Frame timing

**Files:**
- Create: `src/render/frameStats.ts`, `src/render/frameStats.test.ts`
- Modify: `src/main.ts` (time the loop body and the render), `src/ui/hudStore.ts`, `src/ui/Hud.tsx` (debug panel)

**Interfaces:**
- Produces: `class FrameStats { add(cpuMs: number, gpuMs: number | null): void; summary(): { cpuP50: number; cpuP95: number; gpuP50: number | null; gpuP95: number | null; frames: number }; reset(): void }`, holding the last 300 frames. Also `createGpuTimer(gl: WebGL2RenderingContext): { begin(): void; end(): void; poll(): number | null } | null`, which returns null when `EXT_disjoint_timer_query_webgl2` is missing and discards a result when `GPU_DISJOINT_EXT` is set.

- [ ] **Step 1: Write the failing tests** in `frameStats.test.ts`:
  - `summary percentiles over a known sequence`: add cpu 1..100 with gpu null, then expect `cpuP50 === 50`, `cpuP95 === 95` and `gpuP50 === null`.
  - `keeps only the last 300 frames`: add 400 frames, then expect `frames === 300` and that the oldest 100 are gone, checked by the percentile.
  - `gpu percentiles skip nulls`.
- [ ] **Step 2: Run** `npx vitest run src/render/frameStats.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `frameStats.ts`. Wire `main.ts`: `performance.now()` around the whole `setAnimationLoop` body for CPU, and the GPU timer around `renderer.render` plus the mirror passes. The debug panel (`?debug`) shows `cpu p50/p95 ms`, `gpu p50/p95 ms` (or `gpu n/a`), main-pass draw calls and main-pass triangles. Read main-pass numbers by snapshotting `renderer.info.render` right after the main `renderer.render`, before the mirror overlay. Keep the existing whole-frame draw-call number, labelled `all passes`.
- [ ] **Step 4: Run** the test again. Expected: PASS. Then `npx vitest run` and `npx tsc --noEmit`, both green.
- [ ] **Step 5: Baseline.** Run `npm run build && npx vite preview --port 4173`. In the browser pane, open `http://localhost:4173/?debug`, start free drive and stand 20 s at the spawn in the chase view. Record cpu/gpu p50/p95, main-pass draw calls and triangles in a new `## Milestone 4a` section of `docs/perf/README.md`, under "Baseline (before M4a)".
  - CPU is the loop body's own work time and GPU comes from the timer query, so neither is distorted by a hidden pane's throttled frame interval.
  - If the timer query is missing in that browser, write `gpu n/a` and note it.
- [ ] **Step 6: Commit** `feat(render): frame timing in the debug panel`.

### Task 2: Sun position and time-of-day presets

**Files:**
- Create: `src/render/sun.ts`, `src/render/sun.test.ts`, `src/render/timeOfDay.ts`, `src/render/timeOfDay.test.ts`

**Interfaces:**
- Produces: `sunPosition(latDeg: number, lonDeg: number, utcDate: Date): { elevation: number; azimuth: number }` in radians. Azimuth is measured from north, clockwise. A NOAA-style approximation is enough.
- Produces: `sunDirection(elevation, azimuth): [number, number, number]` in world axes (+x east, +y up, +z south): `[sin(az)·cos(el), sin(el), −cos(az)·cos(el)]`.
- Produces: `type TimeOfDay = 'morning' | 'noon' | 'evening'` and `TIMES_OF_DAY: Record<TimeOfDay, LightPreset>`. Each preset is `interface LightPreset { utc: string; sunColor: number; sunIntensity: number; skyColor: number; groundColor: number; hemiIntensity: number; fogColor: number; fogNear: number; fogFar: number; exposure: number; turbidity: number; rayleigh: number }`.
  - The date is 2026-05-15 at Tashkent (41.3111 N, 69.2797 E, UTC+5).
  - Local times: morning 08:30, noon 13:00, evening 18:45.
  - Colours and intensities are the builder's choice. Evening must be visibly warmer and lower than noon.

- [ ] **Step 1: Write the failing tests:**
  - `sunPosition` at Tashkent on 2026-06-21 07:30 UTC (12:30 local, near solar noon) has elevation 72° ± 1° and azimuth 180° ± 10°.
  - On 2026-05-15 at 13:00 local, elevation is 60° to 70°. At 18:45 local, elevation is 2° to 12° and azimuth is 280° to 300°.
  - `sunDirection` with elevation 0 and azimuth 90° (east) gives `[1, 0, 0]`. Azimuth 180° (south) gives `[0, 0, 1]`.
  - Every `TIMES_OF_DAY` preset gives a sun above the horizon. Evening's sun elevation is below morning's and noon's.
- [ ] **Step 2: Run** `npx vitest run src/render/sun.test.ts src/render/timeOfDay.test.ts`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement** both modules. Preset sun positions come from `sunPosition`, not hard-coded angles.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(render): sun position and time-of-day presets`.

### Task 3: Quality presets and their storage

**Files:**
- Create: `src/render/quality.ts`, `src/render/quality.test.ts`

**Interfaces:**
- Produces: `type Quality = 'low' | 'medium' | 'high'` and `QUALITY: Record<Quality, QualitySettings>`, where `interface QualitySettings { pixelRatioCap: number; antialias: boolean; cascades: 1 | 2 | 3; shadowMapSize: 1024 | 2048; shadowFar: number; mirrorSize: [number, number]; mirrorEvery: 1 | 2 | 3; groundTextures: boolean }`.
  - Values: low = 1, false, 1, 1024, 150, [128, 64], 3, false.
  - Values: medium = 1.5, true, 2, 2048, 300, [256, 128], 2, true.
  - Values: high = 2, true, 3, 2048, 450, [256, 128], 2, true.
- Produces: `pickQuality(probeGpuMs: number | null, probeCpuMs: number): Quality`. The probe is the p95 of about 120 frames rendered at medium.
  - It returns high when max(gpu, cpu) ≤ 5, medium when ≤ 10, low otherwise.
  - When gpu is null it decides on cpu only.
- Produces: `loadQuality(): Quality | null` and `saveQuality(q: Quality): void`, under localStorage key `avtomaktab.quality`, with try/catch so blocked storage returns null.

- [ ] **Step 1: Write the failing tests.**
  - Threshold boundaries: 5, 5.01, 10 and 10.01, with gpu null.
  - Unknown stored value gives null.
  - Throwing localStorage (stub `globalThis.localStorage` with throwing getters) gives null and save does not throw.
  - A round trip returns the saved value.
- [ ] **Step 2: Run** `npx vitest run src/render/quality.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(render): quality presets`.

### Task 4: Ground textures and world-space UVs

**Files:**
- Create: `public/textures/` (CC0 files), `src/world/groundMaterials.ts`, `src/world/groundMaterials.test.ts`
- Modify: `src/world/meshes.ts` (UVs), `src/world/buildWorld.ts` (materials), `src/world/environment.ts` (ground plane material), `CREDITS.md`

**Interfaces:**
- Produces: `worldUVs(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry`, which sets `uv = (x / tile, z / tile)` from world positions. `ribbonGeometry` and `polygonGeometry` keep their signatures. `buildWorld` applies `worldUVs` to asphalt, junction, sidewalk, kerb, green and ground geometry before merging.
- Produces: `createGroundMaterials(q: QualitySettings, loader?: THREE.TextureLoader): Record<'asphalt' | 'sidewalk' | 'curb' | 'grass' | 'ground', THREE.Material>`.
  - With `q.groundTextures` false (low preset) it returns plain `MeshLambertMaterial`s in today's colours, so low draws exactly as now.
  - Otherwise it returns `MeshStandardMaterial` with a colour map and a normal map, repeat wrapping, anisotropy 4 and a constant roughness per surface.
- Assets: download at 1k JPG, colour and normal only (no roughness or AO maps), from ambientCG (CC0, `https://ambientcg.com`) or Poly Haven (CC0, `https://polyhaven.com`): one asphalt, one concrete paving for sidewalks, one concrete for kerbs, one grass, one dry ground or dirt.
  - Recompress to JPEG quality 80 if needed so all ten files total at most 4 MB.
  - Record each in `CREDITS.md`.
  - Downloading these is pre-approved by Mukher's approval of this plan: only these ten files, only from those two sites.

- [ ] **Step 1: Write the failing tests.**
  - `worldUVs` on a ribbon from (0,0) to (10,0) with tile 5 has u values spanning 0 to 2, and two ribbons sharing an endpoint get the same UV there, so there is no seam.
  - `createGroundMaterials(QUALITY.low)` returns Lambert materials with today's five colours (0x3d4045 asphalt, 0xc9bfae sidewalk, 0xa8a39a kerb, 0x6f9a4a grass, 0xb8ab8c ground).
  - `createGroundMaterials(QUALITY.high, stubLoader)` returns Standard materials whose `map.wrapS` is `RepeatWrapping`, loading exactly the ten expected paths.
- [ ] **Step 2: Run** `npx vitest run src/world/groundMaterials.test.ts`. Expected: FAIL.
- [ ] **Step 3: Download the textures**, check the licence on each asset page and fill `CREDITS.md`. Then implement and wire in: `buildWorld(scene, d, q: QualitySettings)` takes the settings as a new third parameter (update every caller), and the ground plane uses the `ground` material. Tile sizes are the builder's choice; asphalt grain must read as real at 2 m from the cockpit and must not visibly repeat at 50 m.
- [ ] **Step 4: Run** the tests, then the full suite and tsc. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world): textured ground surfaces`.

### Task 5: Sky, sun and cascaded shadows

**Files:**
- Modify: `src/world/environment.ts` (becomes the lighting rig), `src/main.ts`, `src/camera/mirrors.ts` (size and cadence from quality)
- Create: `src/world/environment.test.ts`

**Interfaces:**
- Consumes: `TIMES_OF_DAY`, `sunPosition`, `sunDirection` (Task 2), and `QUALITY`, `QualitySettings` (Task 3).
- Produces: `createEnvironment(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, q: QualitySettings, tod: TimeOfDay): Environment`, where `interface Environment { follow(x: number, z: number): void; update(): void; setTimeOfDay(tod: TimeOfDay): void; setQuality(q: QualitySettings): void; setupMaterial(m: THREE.Material): void; setupScene(root: THREE.Object3D): void; dispose(): void }`.
  - `update()` is called once per frame before `renderer.render`.
  - `setupScene` traverses once after the world, traffic, pedestrians, signals and car are added, and calls `setupMaterial` on every lit material so CSM can patch it. The rig keeps the list and re-patches it when the cascade count changes. Anything created later calls `setupMaterial` itself.
  - With `q.cascades === 1` it uses one shadowed directional light exactly like today, following the car. With 2 or 3 it uses `CSM` with `maxFar = q.shadowFar`, `shadowMapSize = q.shadowMapSize` and practical split mode.
  - The `Sky` addon is scaled to fit inside the camera far plane (for example 2500), with `depthWrite` false, and its sun uniform comes from `sunDirection`.
  - `scene.fog` colour matches the preset's `fogColor`, and `renderer.toneMappingExposure` matches `exposure`.

- [ ] **Step 1: Write the failing tests** (headless; `THREE.WebGLRenderer` is not available, so pass a stub renderer object with only the fields the rig touches):
  - The sky mesh's bounding radius × scale is less than `camera.far`.
  - `setTimeOfDay('evening')` moves the sun light's direction to match `sunDirection` of the evening preset within 1e-6, and changes the fog colour and exposure.
  - `setQuality(QUALITY.low)` leaves exactly one shadow-casting light. `setQuality(QUALITY.high)` gives 3 cascades with `shadowMapSize` 2048.
  - Switching quality disposes the old lights' shadow maps (spy on `dispose`).
- [ ] **Step 2: Run** `npx vitest run src/world/environment.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Call `env.setupScene(scene)` in `main.ts` after everything is added. Mirrors take `mirrorSize` and `mirrorEvery` from quality.
- [ ] **Step 4: Run** the tests, the full suite and tsc. Expected: PASS.
- [ ] **Step 5: Browser check** (dev server `npx vite --port 5173` in the background; pane at `http://localhost:5173/?debug`). For each time of day on high, take screenshots, and check Review Focus items 1 to 4:
  - chase view at the spawn
  - cockpit view at the spawn
  - all three mirrors
  - a drive of about 200 m on the evening preset

  Write in the commit body what was seen and what was not.
- [ ] **Step 6: Commit** `feat(world): sky, time of day and cascaded shadows`.

### Task 6: Pickers, first-load probe and wiring

**Files:**
- Modify: `src/ui/choices.ts` (+ test), `src/ui/StartScreen.tsx`, `src/i18n/uz.json`, `src/i18n/ru.json`, `src/main.ts`

**Interfaces:**
- Consumes: Tasks 3 and 5.
- Produces: `StartChoice` gains `timeOfDay: TimeOfDay`, defaulting to `'noon'`, with an invalid stored value falling back to it.
  - The start screen shows a time-of-day picker and a quality picker. Quality is stored with `saveQuality`, not in `StartChoice`.
  - New i18n keys are `ui.timeOfDay`, `ui.morning`, `ui.noon`, `ui.evening`, `ui.quality`, `ui.low`, `ui.medium`, `ui.high`, `ui.reloadForAA`, in both languages.
  - On Start, `env.setTimeOfDay` and `env.setQuality` apply the choices.
  - Antialiasing is a renderer constructor option and ground materials are built with the world. If the chosen preset's `antialias` or `groundTextures` differs from what is loaded, the screen shows `ui.reloadForAA` ("applies after reload") and the change takes effect on the next load. Everything else applies on Start.
- First load with no stored quality:
  - Render about 120 frames at medium behind the start screen, collecting `FrameStats`.
  - Call `pickQuality` with the p95s, save the result and apply it.
  - Show the picked preset as selected on the start screen.

- [ ] **Step 1: Write the failing tests.**
  - `loadChoice` with `timeOfDay: 'midnight'` stored returns `'noon'`.
  - Every new i18n key exists in both language files. Extend the existing completeness test if there is one, otherwise add it.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** and wire `main.ts`. On a cold start the probe must not block the start screen from appearing, and must finish before the Start button is enabled.
- [ ] **Step 4: Run** the full suite and tsc. Expected: PASS.
- [ ] **Step 5: Browser check:**
  - Clear site storage, load, and see a preset picked and highlighted.
  - Switch each time of day and each preset across five drives, then check `renderer.info.memory` textures and geometries do not grow between drives (Review Focus 5).
  - Run uz and ru labels.
- [ ] **Step 6: Commit** `feat(ui): time of day and quality pickers`.

### Task 7: Budget check, tuning and before/after shots

**Files:**
- Modify: `docs/perf/README.md` (M4a section), whatever tuning needs (values stay in `src/render/quality.ts` and `src/render/timeOfDay.ts`)
- Create: `docs/visuals/m4a/` (screenshots), `docs/visuals/m4a/README.md`

- [ ] **Step 1: Measure** on a production build (`npm run build && npx vite preview --port 4173`, `/?debug`), using the Task 1 method, for each preset at noon and evening:
  - chase view at the spawn
  - cockpit view at the spawn
  - chase view driving 30 s along the route-1 start

  Record cpu/gpu p50/p95, main-pass draw calls and triangles against the budgets. Also record the download size: the sum of `dist/` sizes, and the M4a share from `public/textures`.
- [ ] **Step 2: Tune** until high is within budget (8 ms cpu and gpu p95, 120 draw calls, 1.5 M triangles) and low within half of it. Log each change with before and after values in the perf section.
  - Tune in this order: cascade count, shadow far, shadow map size, pixel ratio cap, mirror cadence.
  - If high still misses after these, report it rather than cutting features silently.
- [ ] **Step 3: Before/after screenshots** at three spots, each in noon and evening, saved to `docs/visuals/m4a/`:
  - Amir Temur square
  - a wide avenue near the spawn
  - a tree-lined side street

  Take the "before" shots by checking out `main`'s M3 merge in a scratch worktree, never by reverting files here. `README.md` lists each pair with the spot's coordinates, so Mukher can compare with Street View or Yandex panoramas of the same place.
- [ ] **Step 4: Full suite, tsc, build** (delete `dist` after). Expected: all green; headless exam runs unchanged.
- [ ] **Step 5: Commit** `perf(render): M4a budgets and before/after shots`.

---

## Done when

- `npm test`, `npx tsc --noEmit` and `npm run build` pass, and the M3 headless exam runs pass unchanged.
- Sky, three times of day and cascaded shadows show in chase, cockpit and mirrors with none of the Review Focus defects.
- Ground surfaces are textured on medium and high. Low looks as it did before M4a.
- High is within 8 ms cpu and gpu p95, 120 main-pass draw calls and 1.5 M triangles on the Mac. Low is within half.
- M4a assets total at most 4 MB, all recorded in `CREDITS.md`.
- Before/after screenshots are in `docs/visuals/m4a/` for Mukher to judge.
