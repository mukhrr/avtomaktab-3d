# M4b Buildings and Streets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make central Tashkent's buildings and streets recognisable: styled facades with windows, balconies and shop fronts, Soviet panel blocks, roofs with detail, aryk ditches beside avenues, street lamps, bus stops, benches and bins.

**Architecture:**
- The city pipeline gives every building a style and a level count, written into `district.json` and correctable in `overrides.json`. It also extracts street furniture nodes from OSM.
- At load time, buildings become wall and roof meshes in ~200 m chunks, with one facade material.
- That material samples a canvas-drawn atlas, picking the cell from per-vertex style and floor attributes. Its shader patch is chained with the CSM patch by the lighting rig.
- Aryks and lamps are placed procedurally along avenues by pure functions and drawn instanced.
- Bus stops, benches and bins come from OSM nodes.
- Road signs are already 3D plates on poles since M3, so M4b leaves them as they are.

**Tech Stack:** TypeScript 5.6, three 0.169.0, Rapier 0.14 (static colliders for furniture), Vitest 2.1, the `tools/city` pipeline (`npm run city:build`).

**Spec:** `docs/superpowers/specs/2026-10-24-m4-realism-design.md` (parent: `docs/superpowers/specs/2026-10-23-avtomaktab-3d-design.md`).

## Global Constraints

- Free assets only (CC0 or CC-BY), each recorded in `CREDITS.md`.
- M4b plans no downloads; facades and furniture are drawn or modelled in code. If a texture download turns out to be needed, it stops for Mukher's OK. The M4 total stays under 10 MB, of which 3.1 MB is already used.
- Reference machine: Mukher's Mac (Apple M5, Chrome).
  - High preset: at most 8 ms gpu and render-cpu p95 in the chase view, at most 120 main-pass draw calls and 1.5 million triangles.
  - Low preset: judged against its cost before M4b, at most +10 draw calls and +20% gpu p50.
- Nothing the rules read may change. Road geometry, lanes, crossings, signals, signs, the physics colliders of buildings and the M3 headless exam runs all stay as they are.
  - New furniture colliders sit only off the carriageway.
- Visual building geometry stays inside the footprint prism (`buildingMesh` in `src/physics/world.ts`). The exceptions are roof detail above the roof and balconies of at most 1.2 m that start at least 3 m above ground.
- All UI text comes from `src/i18n` (uz and ru).
- No em or en dashes anywhere.
- Code comments only for what the code cannot say.
- Commits are authored by Mukher (`git config user.name` already set), with no Co-Authored-By or "Generated with" lines.

## Review Focus

1. **Wrong style guesses on well-known buildings.** 354 of 424 OSM buildings are plain `building=yes`, so styles come mostly from height and footprint. Expected:
   - A tall slab residential block reads as a panel block.
   - A university or embassy reads as a public building.
   - `overrides.json` can correct any building.

   Task 1 tests override precedence and the classifier on named examples.
2. **Short or odd wall segments.** OSM footprints have many 0.3 to 2 m segments and sharp corners. Expected: no smeared or half windows, because segments shorter than one window bay get a plain wall cell. Task 4 tests this.
3. **Concave footprints and roof detail.** Expected:
   - Parapets and roof boxes never overhang the footprint.
   - A pitched roof only appears on a convex, roughly rectangular footprint.
   - Nothing pokes through a neighbour that shares a wall.

   Task 4 tests parapet containment.
4. **Aryks and lamps in the wrong place.** Expected:
   - None on the carriageway, a junction polygon, a crossing or a driveway mouth (service road junctions).
   - No lamp within 2 m of a tree, sign or signal pole.
   - Lamps in the median only where the median is at least 2 m wide.

   Task 5 tests these with the real district.
5. **Facade shader with CSM, mirrors and the low preset.** Expected:
   - Facades show on low (Lambert), medium and high (Standard with CSM).
   - Facades show in the mirrors.
   - Switching quality keeps both patches.

   Task 2 tests patch chaining. Task 4's browser check covers the rest.

---

### Task 1: Building styles and levels in the pipeline

**Files:**
- Create: `tools/city/styles.ts`, `tools/city/styles.test.ts`
- Modify: `tools/city/extract.ts` (keep the tags needed), `tools/city/build.ts`, `src/shared/district.ts`, `data/districts/tashkent-center/overrides.json`, `public/districts/tashkent-center/district.json` (regenerated)

**Interfaces:**
- Produces in `src/shared/district.ts`:
  - `type BuildingStyle = 'panel' | 'brick' | 'stucco' | 'public' | 'tower' | 'shed'`.
  - `Building` gains `style: BuildingStyle` and `levels: number`.
- Produces `classifyBuilding(input: { tags: Record<string, string>; height: number; footprintArea: number; longSide: number; shortSide: number }): BuildingStyle`. Rules, first match wins:
  - `shed` when `building` is `garages`, `garage`, `roof`, `carport`, `guardhouse`, `shed` or `kiosk`.
  - `public` when `building` is `university`, `school`, `kindergarten`, `civic`, `museum`, `government`, `hospital` or `public`, or `amenity` or `office` is tagged on the way.
  - `tower` when height is 40 m or more.
  - `panel` when `building` is `apartments` or `residential` and levels are 5 or more, or when an untagged building has 5 to 16 levels with `longSide / shortSide` at least 2.5 and `shortSide` at most 18 m.
  - `brick` when levels are 3 or fewer and `footprintArea` is at most 600 m².
  - `stucco` otherwise.
- `levels = max(1, round(height / LEVEL_HEIGHT))`, using the existing 3.2 m.
- `overrides.json` gains `buildingStyles: Record<wayId, BuildingStyle>`, which wins over the classifier.
- `longSide` and `shortSide` come from the footprint's minimum-area bounding rectangle.

- [ ] **Step 1: Write the failing tests** in `styles.test.ts`, one per rule above, plus:
  - An override beats the classifier.
  - `levels` for heights 3, 9.6 and 88 is 1, 3 and 28.
  - A minimum-area rectangle of a rotated 60×12 m rectangle gives sides 60 and 12 within 0.01.
- [ ] **Step 2: Run** `npx vitest run tools/city/styles.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement**, then wire into extract and build.
  - Set overrides for these by way id: the 6 universities and the hotel stay `public`, except Hotel Uzbekistan, which becomes `tower` until M4c replaces it. Add any building the builder can see is misclassified by comparing with satellite or panorama imagery.
  - Run `npm run city:build tashkent-center` (check `package.json` for the exact form) and commit the regenerated `district.json`.
  - Print the style counts in the report.
- [ ] **Step 4: Run** the full suite and tsc. Expected: PASS. The `district.json` diff only adds `style` and `levels`: run `git diff --stat` and spot-check that roads, graph and signs are byte-identical, for example with a jq comparison of everything except `buildings`.
- [ ] **Step 5: Commit** `feat(city): building styles and levels`.

### Task 2: Material patches that survive CSM

**Files:**
- Modify: `src/world/environment.ts`, `src/world/environment.test.ts`

**Interfaces:**
- Produces: a material may carry `userData.patchShader: (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void`.
  - `env.setupMaterial` and every later re-patch, such as a cascade-count change or `setQuality`, install an `onBeforeCompile` that runs the CSM patch (when CSM is on) and then `userData.patchShader`.
  - `customProgramCacheKey` combines both, so programs don't collide.
  - Low (no CSM) still runs `patchShader`.

- [ ] **Step 1: Write the failing tests:**
  - With CSM on, calling the material's `onBeforeCompile` on a stub shader runs both patches, in that order.
  - After `setQuality` to low and back to high, the patch still runs exactly once per compile.
  - A material without `patchShader` behaves as before.
- [ ] **Step 2: Run** `npx vitest run src/world/environment.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the suite and tsc. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world): material shader patches chained with CSM`.

### Task 3: Facade atlas

**Files:**
- Create: `src/world/facadeAtlas.ts`, `src/world/facadeAtlas.test.ts`

**Interfaces:**
- Produces:
  - `FACADE_CELL: Record<BuildingStyle, { ground: number; upper: number; plain: number }>`, the atlas cell index of each style's ground-floor bay, upper-floor bay and plain wall.
  - `BAY_WIDTH: Record<BuildingStyle, number>` in metres, with panel 3.0, brick 3.4, stucco 3.6, public 4.2, tower 3.0 and shed 6.0.
  - `ATLAS_COLS = 6`, `ATLAS_ROWS = 4`.
  - `cellRect(index: number): { u0: number; v0: number; u1: number; v1: number }`.
  - `drawFacadeAtlas(g: CanvasRenderingContext2D, cellPx: number, seed: number): void`, which draws every cell.
  - `createFacadeTexture(): THREE.CanvasTexture`, sRGB with mipmaps and anisotropy 4.
- Look, per style (one bay wide, one floor tall, tileable left-right):
  - **panel:** light grey or beige concrete panel with visible seams, a square window, and a balcony band on alternate cells.
  - **brick:** red-brown brick with a tall window and a stone lintel.
  - **stucco:** cream plaster with a framed window and a cornice line.
  - **public:** a tall window with pilasters.
  - **tower:** blue-grey glass curtain wall with mullions.
  - **shed:** plain plaster, with the ground cell a garage door.
  - **Ground cells:** shop fronts (glass with an awning band) for stucco, panel and public; a recessed entrance for brick.

  No text, logos or brand names anywhere.

- [ ] **Step 1: Write the failing tests** (vitest runs in node, so test layout, not pixels):
  - Every index in `FACADE_CELL` is unique and less than `ATLAS_COLS * ATLAS_ROWS`.
  - `cellRect` tiles the unit square with a half-texel inset, so there is no bleeding at mip 0.
  - `drawFacadeAtlas` called with a recording stub context touches every cell rect. Stub `fillRect`, `beginPath` and so on, and record the bounds.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** The cell size is 256 px, so the atlas is 1536×1024. Mipmaps make neighbouring cells bleed at a distance, so give each cell a 4 px border of its own edge colour.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(world): procedural facade atlas`.

### Task 4: Building meshes, roofs and chunking

**Files:**
- Modify: `src/world/buildings.ts` (rewrite), `src/world/buildWorld.ts` (tree chunking)
- Create: `src/world/buildingGeometry.ts`, `src/world/buildingGeometry.test.ts`, `src/world/chunks.ts`, `src/world/chunks.test.ts`

**Interfaces:**
- Consumes: `Building.style` and `levels` (Task 1), `userData.patchShader` (Task 2), and the atlas API (Task 3).
- Produces: `wallGeometry(b: Building): THREE.BufferGeometry`, with attributes `position`, `normal`, `uv` (u in bays along the wall, v in floors) and `facade` (float cell index per vertex).
  - Each wall segment is split horizontally into a ground-floor strip (cell `ground`) and an upper strip (cell `upper`).
  - A segment shorter than one bay uses `plain` for its full height, and so does a building of style `shed`.
  - u restarts at 0 on each segment and is rounded to whole bays (the segment is divided into `round(len / bay)` bays), so windows never cut at corners.
- Produces: `roofGeometry(b: Building, seed: number): THREE.BufferGeometry`.
  - **Flat roof:** a dark membrane plus a 0.6 m parapet inset 0.25 m from the footprint, built by offsetting the polygon inward. If the inward offset fails (thin or concave footprint), the roof has no parapet.
  - **Roof boxes:** 0 to 3 seeded boxes for panel, stucco and public buildings, such as a lift housing or AC units, each fully inside the inset footprint.
  - **Hipped roof:** for `brick` when the footprint is convex with 4 corners and an aspect ratio of at most 3, or when OSM tagged `roof:shape=hipped`. The roof is 2 m high in terracotta.
- Produces: `chunkKey(x: number, z: number, size = 200): string` and `groupByChunk<T>(items: T[], pos: (t: T) => Vec2, size = 200): Map<string, T[]>`. Buildings are chunked by footprint centroid and tree instances by position. Each chunk is one merged mesh, or one InstancedMesh, with a correct bounding sphere.
- One facade material for all walls:
  - Standard on medium/high, Lambert on low, picked like the other lit materials.
  - It has `map` set to the atlas.
  - Its `userData.patchShader` maps `uv` and `facade` to the atlas cell with `fract`, using a varying for the cell index.
  - Roofs use one plain material. Wall and roof meshes cast and receive shadows.
- Physics colliders are untouched (`buildingMesh` from footprint and height).

- [ ] **Step 1: Write the failing tests:**
  - A 30 m wall with stucco (bay 3.6) has u spanning 0 to 8, because 30 / 3.6 = 8.33 rounds to 8.
  - A 1.5 m segment is `plain`.
  - The ground strip's top is at the first floor height (3.2 m, or 4.5 m for public), and the upper strip runs from there to `height`.
  - The vertex count is 8 per segment (two strips).
  - Every parapet and roof-box vertex lies inside or on the footprint polygon, using `pointInPolygon` with 1 cm tolerance. Check this on a rectangle, an L shape and a thin 3 m wide footprint (no parapet).
  - Hipped roofs only on convex 4-corner brick footprints.
  - `groupByChunk` places every item in exactly one chunk, and the chunk keys of points 199 m and 201 m apart on x differ.
  - On the real district, total wall plus roof triangles are under 250k.
- [ ] **Step 2: Run** `npx vitest run src/world/buildingGeometry.test.ts src/world/chunks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire into `buildWorld`. Remove the old six-colour merge.
- [ ] **Step 4: Run** the suite, tsc and build. Expected: PASS, and the headless exam runs unchanged.
- [ ] **Step 5: Browser check** (dev server `npx vite --port 5173` in the background; any browser tool), with screenshots, covering Review Focus 2, 3 and 5:
  - a panel block
  - a brick house
  - a shop-front street
  - the tower
  - each on high, low and in the mirrors

  Record main-pass draw calls and triangles on high and low.
- [ ] **Step 6: Commit** `feat(world): styled facades, roofs and chunked buildings and trees`.

### Task 5: Aryks and street lamps

**Files:**
- Create: `src/world/streetside.ts`, `src/world/streetside.test.ts`
- Modify: `src/world/buildWorld.ts`, `src/physics/world.ts` (lamp colliders), `src/world/vegetation.ts` (only if trees must move out of the aryk line)

**Interfaces:**
- Produces: `aryks(d: DistrictData): { points: Vec2[]; width: number }[]`.
  - Aryks run along roads of kind `primary`, `secondary` and `tertiary`, on both sides, at offset `width / 2 + 1.6` from the road centreline (between the kerb and the tree row, which is at +3).
  - Each aryk is 0.6 m wide.
  - They break at every junction polygon (reuse `junctionPolygon`/`junctionTrim`), within 4 m of a crossing, and where a footway or service road meets the road.
  - Runs shorter than 6 m are dropped.
- Produces: `lampPositions(d: DistrictData, seed: number): { x: number; z: number; heading: number; double: boolean }[]`.
  - Lamps sit on the same road kinds, every 32 m.
  - On a divided road (two oneway edges of the same road name within 30 m, running in parallel), there is one double-arm lamp in the median if the median is at least 2 m wide. Otherwise lamps alternate sides at offset `width / 2 + 0.8`.
  - Exclusions: none inside any carriageway ribbon or junction polygon, none within 3 m of a crossing, and none within 2 m of a tree, sign or signal position.
- Rendering:
  - Aryks are a concrete-edged channel strip with a dark water surface just above ground, merged per chunk.
  - Lamps are an InstancedMesh of a tapered pole plus a head, with a Tashkent-style curved single or double arm.
- Lamps get static cylinder colliders (radius 0.12 m, height 8 m), so hitting one counts as a collision with an object. That works the same way as buildings today (main.ts emits `with: 'building'`).

- [ ] **Step 1: Write the failing tests** on the real `district.json`:
  - No aryk point lies inside any carriageway ribbon, junction polygon or crossing.
  - No lamp lies inside any of those, or within 2 m of a tree, sign or signal.
  - Lamp spacing along a straight avenue edge is 32 m ± 1 m.
  - At least one median double lamp exists on a divided avenue.
  - The function is deterministic for a seed.
- [ ] **Step 2: Run** `npx vitest run src/world/streetside.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire in.
- [ ] **Step 4: Run** the suite, tsc and build. Expected: PASS, and the headless exam runs unchanged. The careful driver never touches a lamp, because the test driver uses box overlap with AI cars only. Add an assertion in `examRun.test.ts` that the careful run's path never comes within 1 m of a lamp position.
- [ ] **Step 5: Browser check** with screenshots of an avenue with an aryk, trees and lamps in the noon and evening chase view. Record draw calls.
- [ ] **Step 6: Commit** `feat(world): aryks and street lamps`.

### Task 6: Bus stops, benches and bins

**Files:**
- Modify: `tools/city/extract.ts`, `tools/city/build.ts`, `src/shared/district.ts`, `public/districts/tashkent-center/district.json` (regenerated), `src/physics/world.ts`
- Create: `src/world/furniture.ts`, `src/world/furniture.test.ts`

**Interfaces:**
- Produces in `DistrictData`: `furniture: { id: string; kind: 'busStop' | 'bench' | 'bin'; x: number; z: number; heading: number }[]`.
  - Sources are OSM nodes `highway=bus_stop` (33 today), `amenity=bench` (26) and `amenity=waste_basket` (28).
  - `heading` faces the nearest road. A bus stop is snapped to stand 1.5 m beyond the kerb of the nearest drivable edge, facing it.
  - Items that would land inside a carriageway, junction or crossing are moved out along the road normal or dropped, with a count in the build log.
- Rendering: InstancedMeshes, one per kind and part.
  - **Bus shelter:** roof, back glass, side panel and bench, 4 m long.
  - **Bench:** a simple slatted bench.
  - **Bin:** a cylinder with a rim.
- Static cuboid colliders for bus shelters only. Benches and bins are visual only.

- [ ] **Step 1: Write the failing tests:**
  - Extracting from a fixture with one bus stop, one bench and one bin gives three items of the right kinds.
  - On the real district, no furniture lies inside a carriageway, junction or crossing.
  - Every bus stop is within 4 m of a drivable edge's kerb and faces it, with heading toward the road within 15°.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, regenerate `district.json` (check that only `furniture` is added), and wire in rendering and colliders.
- [ ] **Step 4: Run** the suite, tsc and build. Expected: PASS, and the exam runs unchanged.
- [ ] **Step 5: Commit** `feat(world): bus stops, benches and bins`.

### Task 7: Budget check and before/after shots

**Files:**
- Modify: `docs/perf/README.md` (M4b section), tuning in the files above
- Create: `docs/visuals/m4b/` (screenshots), `docs/visuals/m4b/README.md`

- [ ] **Step 1: Measure** with the M4a method (production build, an unthrottled browser, `?debug`, `__game.lastFrame`) on high and low, at noon and evening, in these views:
  - chase view at the spawn
  - cockpit view at the spawn
  - a 30 s drive along the start of route-1

  Record gpu and render-cpu p50/p95, main-pass draw calls, triangles and steps per frame against the budgets. Record the download size too.
- [ ] **Step 2: Tune** until high passes and low is within +10 calls and +20% gpu p50 of before M4b. Log each change with before and after values.
  - Tune in this order: chunk size, roof boxes, lamp spacing on low, aryks off on low.
  - Report any miss instead of cutting features silently.
- [ ] **Step 3: Screenshots** at four spots, each in noon and evening, with the same framing for before and after, saved to `docs/visuals/m4b/`:
  - the M4a three: Amir Temur square, the avenue near the spawn, Istiqbol ko'chasi
  - one panel-block street the builder picks

  Take the "before" shots from a scratch worktree of `main`, then remove it. The README lists coordinates and Yandex/Google panorama links, as in M4a.
- [ ] **Step 4: Full suite, tsc, build** (delete `dist`). Expected: all green.
- [ ] **Step 5: Commit** `perf(world): M4b budgets and before/after shots`.

---

## Done when

- `npm test`, `npx tsc --noEmit` and `npm run build` pass, and the M3 headless exam runs pass unchanged.
- Every building has a style, and the overrides file corrects the known ones. Facades show windows, balconies and shop fronts on every preset and in the mirrors, with none of the Review Focus defects.
- Avenues have aryks, lamps and bus stops in plausible places, and none sit on the carriageway, a junction or a crossing.
- High stays within 8 ms gpu and render-cpu p95, 120 main-pass draw calls and 1.5 M triangles on the Mac. Low is within +10 calls and +20% gpu p50 of before M4b.
- No new downloads, or any downloads approved by Mukher and recorded in `CREDITS.md`.
- Before/after screenshots are in `docs/visuals/m4b/` for Mukher to judge.
