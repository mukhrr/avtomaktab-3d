# M4c Landmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the landmarks a Tashkent driver recognises into the district as simple hand-made models: the Amir Temur equestrian monument, the square's fountains, Hotel Uzbekistan, the Tashkent Chimes (Kuranty), the Palace of International Forums and the State Museum of Timurid History.

**Architecture:**
- The city pipeline tags landmark buildings and nodes in `district.json` (`landmarks` list), using fixed OSM ids from `overrides.json`.
- Each landmark kind has a pure geometry builder in `src/world/landmarks/`.
- `addBuildings` skips buildings that a landmark replaces visually.
- Physics keeps the building prisms. Free-standing landmarks (monument, fountains) get simple static colliders.

**Tech Stack:** TypeScript 5.6, three 0.169.0, Rapier 0.14, Vitest 2.1, the `tools/city` pipeline.

**Spec:** `docs/superpowers/specs/2026-10-24-m4-realism-design.md` (Goals 1, "Landmarks").

## Global Constraints

- No downloads. Every model is built in code from primitives, lathes and extrusions, plus canvas textures where a pattern is needed.
- Nothing the rules read may change, including roads, lanes, crossings, signals, signs and the M3 headless exam runs. Building physics prisms (`buildingMesh`) stay as they are.
- Landmark visuals stay inside their footprint prism, except for parts above the roof and the Kuranty tower above its 6 m OSM height. Free-standing landmarks stay inside the park and off every carriageway, footway and crossing.
- Budgets on the reference Mac: high at most 8 ms gpu p95 and 120 main-pass calls, low at most +6 calls over before M4c. All landmarks together stay under 120k triangles.
- Comments only for what code cannot say. No em or en dashes. Commits by Mukher with no Co-Authored-By or "Generated with" lines.
- Look: clean and stylised like the rest of the city, recognisable by silhouette and colour first.

## Landmark facts (from OSM, game metres: +x east, +z south)

| Landmark | OSM | Position | Notes |
|---|---|---|---|
| Amir Temur monument | node 377979982 | (5, -8), square centre | Bronze rider on a horse, raised right hand, on a dark granite pedestal; about 11 m total |
| Square fountains | ways 1368039613, 1368039614, 1368039615, 1368039616 | around the monument | Round basins with jets |
| Hotel Uzbekistan | way 44491343, 71.5 m | footprint x 233 to 274, z -73 to 16 | Curved concave slab, white with a deep geometric lattice screen over the whole facade, about 17 floors |
| Tashkent Chimes (Kuranty) | way 83581462, plus clock node 565346454 at (5, 164) | footprint x 1 to 25, z 156 to 176 | White tower about 30 m tall: arched base, clock faces on 4 sides, spire. OSM height of 6 m is the base building |
| Palace of International Forums | way 44351799, 40.2 m | footprint x 169 to 312, z 104 to 241 | White box behind a tall colonnade with a large blue dome on top |
| State Museum of Timurid History | way 31972619, 8 m | footprint x -96 to -23, z -322 to -249 | Round building with a ribbed blue dome on a drum |

---

### Task 1: Landmarks in the pipeline

**Files:**
- Modify: `tools/city/build.ts`, `src/shared/district.ts`, `data/districts/tashkent-center/overrides.json`, `public/districts/tashkent-center/district.json` (regenerated)
- Create: `tools/city/landmarks.ts`, `tools/city/landmarks.test.ts`

**Interfaces:**
- Produces: `type LandmarkKind = 'amirTemur' | 'fountain' | 'hotelUzbekistan' | 'kuranty' | 'forumsPalace' | 'timuridMuseum'`.
- Produces: `DistrictData.landmarks: { id: string; kind: LandmarkKind; x: number; z: number; heading: number; buildingId?: string; footprint?: Vec2[]; radius?: number }[]`.
  - Building landmarks carry `buildingId` and the footprint copied from the building.
  - The monument carries `radius` 6 (its plinth).
  - Fountains carry the polygon's centroid and `radius` from its area.
  - `heading` points toward the square centre (0, 0) for all of them, except fountains, which get 0.
- `overrides.json` gains `landmarks: Record<osmId, LandmarkKind>`, set to the table above. The extractor reads nodes and ways by id from the raw OSM. An id that is missing from the OSM file fails the build with a clear message.

- [ ] **Step 1: Write the failing tests.**
  - On a fixture, a node id and a way id map to the right kinds and positions.
  - A missing id throws.
  - On the real district: 6 kinds, 4 fountains, and the hotel's `buildingId` is `44491343`.
  - Every non-building landmark is at least 3 m from every graph edge ribbon and from every crossing.
- [ ] **Step 2: Run** `npx vitest run tools/city/landmarks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then regenerate `district.json`. Check with python that only `landmarks` is added.
- [ ] **Step 4: Run** the suite and tsc. Expected: PASS.
- [ ] **Step 5: Commit** `feat(city): landmarks in district data`.

### Task 2: Landmark models

**Files:**
- Create: `src/world/landmarks/amirTemur.ts`, `fountain.ts`, `hotelUzbekistan.ts`, `kuranty.ts`, `forumsPalace.ts`, `timuridMuseum.ts`, `index.ts`, `landmarks.test.ts`

**Interfaces:**
- Produces: `buildLandmark(l: Landmark): THREE.Group`, positioned and rotated in world space. Meshes use Lambert materials with vertex colours or small canvas textures. Lit-material swap and CSM work as for the rest of the world.
- Each builder is a pure function of the landmark. Shapes:
  - **amirTemur:**
    - A stepped granite pedestal (two tiers, about 6.5 m in total), bronze-coloured.
    - The horse is built from capsules or lathes for the body, neck, head and four legs, with the near front leg raised.
    - The rider has a cloak, a crowned head and a raised right arm. Silhouette first, about 4.5 m tall.
  - **fountain:** a round stone basin, 0.6 m high, with water and 5 to 9 thin translucent jets (cones).
  - **hotelUzbekistan:** walls extruded from the real footprint to 71.5 m. A canvas lattice texture (white diamond or rhombus screen over dark glass) tiles by world metres, with a plain white top band.
  - **kuranty:**
    - The 6 m base keeps the footprint.
    - On it stands a 4×4 m square tower to 26 m, with arched openings at the bottom.
    - A clock band at 18 to 22 m carries a canvas clock face on each side.
    - A slender spire with a gold tip rises to 32 m.
  - **forumsPalace:**
    - The footprint walls in white rise to 30 m.
    - A colonnade of round columns runs along the longest side facing the square, 1.5 m in front of the wall and inside the footprint.
    - A blue dome on a drum sits at the centre, its top at 40.2 m.
  - **timuridMuseum:** a round drum fitted inside the footprint's largest inscribed circle, 8 m high with arched window recesses, then a ribbed blue lathe dome to about 20 m and a small finial.

- [ ] **Step 1: Write the failing tests:**
  - Every builder returns a group with at least one mesh.
  - Total triangles for all landmarks in the real district are under 120k.
  - Every vertex of a building landmark lies inside its footprint prism. Exceptions: parts above the footprint height for kuranty, forumsPalace and timuridMuseum, and the colonnade, which must still be inside the footprint polygon. Check with `pointInPolygon` and 5 cm tolerance.
  - The monument's top is between 10 and 12 m.
  - Kuranty's top is between 30 and 34 m.
  - Builders are deterministic: two calls give identical position arrays.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the suite and tsc. Expected: PASS.
- [ ] **Step 5: Commit** `feat(world): landmark models`.

### Task 3: Placing landmarks in the world

**Files:**
- Modify: `src/world/buildings.ts` (skip landmark buildings), `src/world/buildWorld.ts`, `src/physics/world.ts`, `src/world/vegetation.ts` and `src/world/streetside.ts` (no trees or lamps inside landmark footprints or monument and fountain radius plus 1 m)

**Interfaces:**
- `addBuildings` skips any building whose id is a landmark `buildingId`. Physics still builds that building's prism.
- `addLandmarks(scene, d)` adds every landmark group. Static colliders:
  - a cylinder for the monument pedestal (radius 6, height 6.5)
  - a 0.6 m high cylinder for each fountain basin
- Trees and lamps skip landmark areas. Keep it deterministic: filter after all rng draws, as Task 6 of M4b did for shelters.

- [ ] **Step 1: Write the failing tests:**
  - The landmark buildings are absent from the facade batch and present in physics.
  - No tree or lamp is inside a landmark footprint or radius plus 1 m.
  - The exam careful path stays more than 3 m from the monument and the fountains. Add this to `examRun.test.ts`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the suite, tsc and build. Expected: PASS, and the exam runs are unchanged.
- [ ] **Step 5: Browser check:**
  - Take screenshots of each landmark from street level at noon and evening on high, plus one on low.
  - Take one aerial shot of the square from the M4a `square` framing.
  - Save them to `docs/visuals/m4c/`, with a README listing panorama links per landmark (Yandex and Google, as in M4a).
  - Record main-pass calls and triangles.
- [ ] **Step 6: Commit** `feat(world): landmarks placed with colliders`.

### Task 4: Budget check

- [ ] **Step 1: Measure** high and low with the M4a method, comparing before and after M4c (scratch worktree of the branch base). Use the chase view at the spawn and an orbit view of the square.
- [ ] **Step 2: Tune** if needed: reduce lathe segments first, then the colonnade column count. Write the result into `docs/perf/README.md` under an M4c section.
- [ ] **Step 3: Full suite, tsc, build.** Commit `perf(world): M4c budget check`.

## Done when

- `npm test`, `npx tsc --noEmit` and `npm run build` pass, and the M3 exam runs are unchanged.
- All six landmark kinds stand in the right places, recognisable by silhouette, with screenshots and panorama links in `docs/visuals/m4c/`.
- High is within 8 ms gpu p95 and 120 calls. Low is at most +6 calls over before M4c.
