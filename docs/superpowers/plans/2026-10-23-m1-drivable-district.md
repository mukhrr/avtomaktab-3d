# Milestone 1: Drivable Tashkent District Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web build where you drive a Cobalt with real physics (manual and automatic) through central Tashkent generated from OpenStreetMap, with proper junctions, buildings, trees, traffic light poles, cockpit view with mirrors, and a HUD.

**Architecture:** An offline Node pipeline (`tools/city`) turns an OSM extract plus a hand-written override file into one `district.json` (features + road graph). The browser game (`src/`) loads it, builds merged Three.js meshes, and runs a Rapier raycast vehicle whose engine force comes from a pure, unit-tested drivetrain model. React renders only the HUD.

**Tech Stack:** TypeScript 5.6, Vite 5.4, Vitest 2.1, three 0.169.0, @dimforge/rapier3d-compat 0.14.0, React 18.3.1, fast-xml-parser 4.5, tsx 4.19.

**Spec:** `docs/superpowers/specs/2026-10-23-avtomaktab-3d-design.md`
**Prior art in repo:** `spike/` (throwaway test, see `spike/convert.py` and `spike/index.html` for the projection, ribbon and tree-placement approach that worked).

**Later milestones (separate plans, not this one):** M2 AI traffic, traffic light logic, pedestrians. M3 rule engine, examiner route, voice, debrief. M4 menus, uz/ru i18n, free-asset art pass (car models, facades, landmarks like the Amir Temur monument and Hotel Uzbekistan), quality presets, deploy.

## Global Constraints

- Right-hand traffic.
- District: central Tashkent, bbox lon 69.2700–69.2900, lat 41.3040–41.3180; projection origin Amir Temur square lat 41.3111, lon 69.2797. +x = east, +z = south (metres), y up.
- OSM data is ODbL: the game shows "© OpenStreetMap contributors" on screen at all times.
- Only CC0/CC-BY assets; every third-party asset gets a line in `CREDITS.md` (name, author, licence, URL).
- Performance target: 60 fps on a mid-range laptop with integrated graphics at 1080p. First playable load under 30 MB.
- Desktop Chrome and Edge are the targets. Keyboard is required; gamepad is optional.
- Car: Chevrolet Cobalt dimensions 4.48 m × 1.74 m × 1.51 m, wheelbase 2.62 m, mass 1150 kg, wheel radius 0.31 m.

## Review Focus

1. **Messy OSM input** (ways with fewer than 2 resolvable nodes, unparsable `lanes`/`height`/`maxspeed` values, stacked duplicate ways): the pipeline skips or defaults them and never throws. Pinned in Task 3.
2. **Bad building footprints** (fewer than 3 distinct points, clockwise or counter-clockwise winding, closing duplicate point): degenerate ones are dropped, the rest extrude upward with correct normals. Pinned in Task 3 and Task 6.
3. **Frame-time spikes** (tab hidden then shown, dt of seconds): physics steps in fixed 1/60 s substeps capped at 5 per frame, so the car never tunnels through a building. Pinned in Task 9.
4. **Gamepad disconnects mid-drive:** controls drop to keyboard-only on the same frame, and throttle goes to 0 if no key is held. Pinned in Task 8.
5. **Stall or leaving the map** (manual stall at a light, driving past the district edge or flipping): the engine restarts with a key, and R or leaving bounds resets the car to the nearest road lane facing along it. Pinned in Task 7 and Task 9.

---

### Task 1: Project scaffold, shared types, projection

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `index.html`, `src/main.ts`, `CREDITS.md`
- Create: `src/shared/district.ts` (types shared by pipeline and game)
- Create: `tools/city/projection.ts`
- Test: `tools/city/projection.test.ts`

**Interfaces:**
- Produces:
  - `type Vec2 = [number, number]` (x, z metres)
  - `interface Road { id: string; kind: string; width: number; lanes: number; oneway: boolean; name: string; maxspeed: number; points: Vec2[] }`
  - `interface Building { id: string; height: number; footprint: Vec2[] }` (counter-clockwise, no closing duplicate)
  - `interface Area { id: string; kind: 'green' | 'water'; outline: Vec2[] }`
  - `interface Waterway { id: string; width: number; points: Vec2[] }`
  - `interface Signal { id: string; position: Vec2 }`
  - `interface GraphNode { id: string; position: Vec2; edges: string[] }`
  - `interface GraphEdge { id: string; from: string; to: string; roadId: string; points: Vec2[]; lanesForward: number; lanesBackward: number; width: number; maxspeed: number; name: string }`
  - `interface DistrictData { name: string; origin: { lat: number; lon: number }; bounds: { minX: number; maxX: number; minZ: number; maxZ: number }; roads: Road[]; buildings: Building[]; areas: Area[]; waterways: Waterway[]; signals: Signal[]; graph: { nodes: GraphNode[]; edges: GraphEdge[] } }`
  - `makeProjection(origin: { lat: number; lon: number }): (lat: number, lon: number) => Vec2`

- [ ] **Step 1: Init repo and install**

```bash
git init
npm init -y
npm i three@0.169.0 @dimforge/rapier3d-compat@0.14.0 react@18.3.1 react-dom@18.3.1
npm i -D typescript@5.6 vite@5.4 vitest@2.1 tsx@4.19 fast-xml-parser@4.5 @types/three@0.169.0 @types/react@18.3 @types/react-dom@18.3 @vitejs/plugin-react@4.3
```

`.gitignore`: `node_modules`, `dist`, `data/raw/`, `spike/osm.xml`, `spike/osm.json`. Scripts in `package.json`: `dev` = `vite`, `build` = `tsc --noEmit && vite build`, `test` = `vitest run`, `city:fetch` = `tsx tools/city/fetch.ts`, `city:build` = `tsx tools/city/build.ts`. `tsconfig`: strict, `moduleResolution: bundler`, `jsx: react-jsx`, includes `src` and `tools`.

- [ ] **Step 2: Write the failing test**

```ts
import { makeProjection } from './projection';
const p = makeProjection({ lat: 41.3111, lon: 69.2797 });
test('origin maps to 0,0', () => expect(p(41.3111, 69.2797)).toEqual([0, 0]));
test('east is +x, north is -z', () => {
  const [x, z] = p(41.3111 + 0.001, 69.2797 + 0.001);
  expect(x).toBeCloseTo(83.6, 0);   // 0.001° lon * 111320 * cos(41.3111°)
  expect(z).toBeCloseTo(-110.5, 0); // 0.001° lat * 110540, north is negative z
});
```

- [ ] **Step 3: Run test, expect FAIL** (`npx vitest run tools/city/projection.test.ts`, module not found)
- [ ] **Step 4: Implement `makeProjection`** in `tools/city/projection.ts` as an equirectangular projection with KX = 111320·cos(origin lat), KZ = 110540, rounded to 0.01 m. Write `src/shared/district.ts` types as above.
- [ ] **Step 5: Run test, expect PASS.** Also `npm run dev` shows a blank page with no console errors.
- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold project, shared district types, projection"
```

---

### Task 2: OSM parsing and fetch script

**Files:**
- Create: `tools/city/osm.ts`, `tools/city/fetch.ts`
- Create: `tools/city/fixtures/mini.osm.xml` (hand-written, ~15 nodes: two crossing two-way residential roads, one oneway primary, one 4-node building with `building:levels=4`, one park, one `highway=traffic_signals` node, one way referencing a missing node)
- Test: `tools/city/osm.test.ts`

**Interfaces:**
- Produces:
  - `interface OsmNode { id: string; lat: number; lon: number; tags: Record<string, string> }`
  - `interface OsmWay { id: string; nodeIds: string[]; tags: Record<string, string> }`
  - `parseOsm(xml: string): { nodes: Map<string, OsmNode>; ways: OsmWay[] }`
  - `interface DistrictConfig { name: string; bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number]; origin: { lat: number; lon: number } }` in `src/shared/district.ts`
  - `fetch.ts` CLI: `npm run city:fetch -- tashkent-center` downloads `https://api.openstreetmap.org/api/0.6/map?bbox=<minLon>,<minLat>,<maxLon>,<maxLat>` to `data/raw/<district>.osm.xml`, reading a `DistrictConfig` from `data/districts/<district>/district.config.json`. Sends a `User-Agent: avtomaktab-3d/0.1` header. (The Overpass API was overloaded during the test, so use the main API.)

- [ ] **Step 1: Write failing tests:** `parseOsm(fixture)` returns all fixture nodes with numeric lat/lon; the building way has `tags['building:levels'] === '4'`; a node with a single `<tag>` still gets a tags object (fast-xml-parser returns a single object instead of an array, so normalise with `isArray`); a way with one `<nd>` is still returned (filtering is Task 3's job).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `parseOsm`** with fast-xml-parser (`ignoreAttributes: false`, `attributeNamePrefix: ''`, `isArray` for `node`, `way`, `nd`, `tag`). Write `fetch.ts` and `data/districts/tashkent-center/district.config.json` with the bbox and origin from Global Constraints.
- [ ] **Step 4: Run tests, expect PASS.** Then run `npm run city:fetch -- tashkent-center`. Expected: `data/raw/tashkent-center.osm.xml` is about 5 MB and starts with `<?xml`.
- [ ] **Step 5: Commit** (`feat(city): parse OSM XML and fetch district extract`)

---

### Task 3: Feature extraction with overrides

**Files:**
- Create: `tools/city/extract.ts`, `data/districts/tashkent-center/overrides.json`
- Test: `tools/city/extract.test.ts`

**Interfaces:**
- Consumes: `parseOsm`, `makeProjection`, shared types.
- Produces:
  - `interface Overrides { removeWays: string[]; roads: Record<string, Partial<Pick<Road, 'width' | 'lanes' | 'oneway' | 'maxspeed' | 'name'>>>; buildingHeights: Record<string, number> }` (keys are OSM way ids)
  - `extractFeatures(osm: ReturnType<typeof parseOsm>, project: (lat: number, lon: number) => Vec2, overrides: Overrides): Omit<DistrictData, 'name' | 'origin' | 'bounds' | 'graph'>`

Rules to implement (values from the spike that worked):
- Car roads: `highway` in motorway, trunk, primary, secondary, tertiary, residential, unclassified, service, living_street, and `*_link`. Footways: footway, path, cycleway, pedestrian (kept as roads with `kind` set; game renders them as sidewalks).
- Default width by kind: motorway/trunk 14, primary 12, secondary 10, tertiary 8, residential/unclassified 6, living_street 5, service 4, links 6, pedestrian 4, footway/cycleway 2, path 1.5. If `lanes` parses as an integer, width = max(default, lanes × 3.5). Default lanes = max(1, round(width / 3.5)).
- `maxspeed`: parse leading integer, default 60 for car roads (Uzbek city default), 20 for living_street and service.
- `oneway`: `yes`, `true` or `1`.
- Name: `name:uz`, then `name`, then `''`.
- Building height: `height` (leading number), else `building:levels` × 3.2, else seeded 8 + (hash(id) % 5) × 3.2 so it's stable between builds. Override wins.
- Footprints: drop the closing duplicate, drop if fewer than 3 distinct points or |area| < 4 m², force counter-clockwise in x/z.
- Areas: green = `leisure` park/garden, `landuse` grass/forest/recreation_ground, `natural=wood`. Water = `natural=water`. Waterways: `waterway` canal/river (width 9) and stream (3).
- Signals: nodes with `highway=traffic_signals`.
- Any way with fewer than 2 resolvable nodes is skipped silently.

- [ ] **Step 1: Write failing tests** against the fixture: the oneway primary has `oneway: true`, `width: 12`, `maxspeed: 60`; the building has `height` ≈ 12.8 and counter-clockwise winding (positive signed area in x/z); the way with a missing node is absent; an override `{ roads: { '<id>': { lanes: 3 } } }` gives width 10.5; `removeWays` drops a way; `lanes: '2;3'` and `height: 'tall'` don't throw and fall back to defaults; a clockwise input footprint comes out counter-clockwise.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `extractFeatures`.** Create `overrides.json` as `{ "removeWays": [], "roads": {}, "buildingHeights": {} }`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(city): extract roads, buildings, areas and signals`)

---

### Task 4: Road graph

**Files:**
- Create: `tools/city/graph.ts`
- Test: `tools/city/graph.test.ts`

**Interfaces:**
- Consumes: OSM ways (for shared node ids), `Road[]` from Task 3.
- Produces: `buildRoadGraph(roads: Road[], roadNodeIds: Map<string, string[]>, project: (id: string) => Vec2): { nodes: GraphNode[]; edges: GraphEdge[] }`. `roadNodeIds` maps road id to its OSM node ids in order. Car roads only (no footways).

Algorithm: an OSM node becomes a graph node if it's a way endpoint or appears in 2 or more car roads. Each road is split at its graph nodes into edges; edge `points` include both ends. For a oneway road, `lanesForward` = lanes and `lanesBackward` = 0. For a two-way road, `lanesForward` = ceil(lanes / 2) and `lanesBackward` = floor(lanes / 2), minimum 1 each. Edge ids are `${roadId}:${index}`. Each node's `edges` lists every edge touching it.

- [ ] **Step 1: Write failing tests** with the fixture: the two crossing residential roads give 1 shared junction node with 4 edges; the oneway primary gives edges with `lanesBackward === 0`; a 2-lane two-way road gives 1 and 1; every edge's first/last point equals its from/to node position.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `buildRoadGraph`.** Change `extractFeatures` to also return `roadNodeIds` (keep the output type above plus this map, not part of `DistrictData`).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(city): build directed road graph`)

---

### Task 5: District build CLI

**Files:**
- Create: `tools/city/build.ts`
- Output (committed): `public/districts/tashkent-center/district.json`
- Test: `tools/city/build.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `buildDistrict(xml: string, config: DistrictConfig, overrides: Overrides): DistrictData` plus the CLI `npm run city:build -- tashkent-center`, which reads raw XML, config and overrides, and writes compact JSON. `bounds` = bbox projected to metres.

- [ ] **Step 1: Failing test:** `buildDistrict(fixtureXml, fixtureConfig, emptyOverrides)` returns `graph.edges.length > 0` and every `edge.roadId` exists in `roads`, and the result survives a `JSON.parse(JSON.stringify(x))` round trip unchanged.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Run on real data:** `npm run city:build -- tashkent-center`. Expected: the console prints counts in the same range as the spike (about 1,300 roads including footways, about 420 buildings, about 80 signals) and the file is under 2 MB.
- [ ] **Step 6: Commit** including `district.json` (`feat(city): build tashkent-center district`)

---

### Task 6: Road and junction geometry

**Files:**
- Create: `src/world/roadGeometry.ts`
- Test: `src/world/roadGeometry.test.ts`

**Interfaces:**
- Consumes: `GraphNode`, `GraphEdge`.
- Produces (pure, Three-free, return flat arrays so they're testable):
  - `ribbon(points: Vec2[], width: number): { positions: number[]; indices: number[] }` (mitred joints, miter clamped to 2× half-width, as in the spike)
  - `junctionPolygon(node: GraphNode, edges: GraphEdge[]): Vec2[]` (counter-clockwise)
  - `trimEdge(edge: GraphEdge, startTrim: number, endTrim: number): Vec2[]`
  - `junctionTrim(node: GraphNode, edges: GraphEdge[]): Map<string, number>` (edge id to metres trimmed at this node)

Algorithm: at a node with 3+ edges, trim each edge by `max(width of other edges) / 2 + 1` m, clamped to 45% of edge length. The junction polygon is the convex hull of the left and right corners of every trimmed edge end. Nodes with 2 edges (bends) aren't junctions: no trim, the ribbon mitres through. This replaces the spike's overlapping ribbons, which caused z-fighting and messy markings at junctions.

- [ ] **Step 1: Failing tests:** `ribbon` on a straight 2-point line of width 6 gives 4 vertices at ±3 from the centre; on a 90° bend the corner offset is ≤ 2 × half-width; `junctionPolygon` for a 4-way cross of 6 m roads is counter-clockwise, contains the node position, and has 8 points or fewer; `junctionTrim` for a 4-way cross gives 4 m for every edge; trimming never makes an edge shorter than 10% of its length.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(world): road ribbons and junction polygons`)

---

### Task 7: World rendering

**Files:**
- Create: `src/world/buildWorld.ts`, `src/world/buildings.ts`, `src/world/vegetation.ts`, `src/world/signals.ts`, `src/world/markings.ts`, `src/world/spawn.ts`
- Test: `src/world/spawn.test.ts`, `src/world/vegetation.test.ts`
- Modify: `src/main.ts`, `index.html`

**Interfaces:**
- Consumes: `DistrictData`, Task 6 geometry.
- Produces:
  - `buildWorld(scene: THREE.Scene, d: DistrictData): void` (one merged mesh per material: asphalt, junctions, curbs, sidewalks, markings, green, water, one per building colour)
  - `nearestLane(d: DistrictData, x: number, z: number): { position: Vec2; heading: number; edge: GraphEdge } | null`: the closest edge, placed in the centre of the rightmost forward lane (right-hand traffic), heading along travel direction. Used for spawn and reset.
  - `treePositions(d: DistrictData, seed: number): Vec2[]`: every 10 m along both sides of primary/secondary/tertiary/trunk roads at width/2 + 3 m, plus random points inside green areas at about 1 per 150 m², capped at 300 per area; excluding points inside buildings or on carriageways.

Render details: road y layers green 0.03, water 0.05, sidewalk 0.06, curb 0.07, asphalt and junctions 0.09, markings 0.11. Markings: dashed 3 m on / 6 m off for two-way roads up to 10 m wide, solid centre line on two-way roads over 10 m, lane dividers dashed on multi-lane roads, none inside junction polygons. Buildings: extruded footprints, 6 warm stucco/beige colours picked by id hash, cast shadows. Trees: 2 instanced meshes (trunk, crown). Signals: pole + 3-lamp box placed at the curb of the nearest edge, facing oncoming traffic (static yellow-off for now; M2 adds logic). Persistent bottom-left text: "© OpenStreetMap contributors". Directional sun with shadows following the car, hemisphere light, fog from 250 to 900 m.

- [ ] **Step 1: Failing tests:** `nearestLane` on a two-way east-west 2-lane edge at a point north of it returns a position south of the centreline (right lane for eastbound travel) with heading east; on a oneway edge it returns a point offset into the rightmost lane; `treePositions` with the same seed returns identical arrays, and no position lies within any road's width/2 of its centreline.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Manual check:** `npm run dev`, then fly a debug orbit camera (`?debug=orbit` query flag using OrbitControls). Expected: junctions are clean single surfaces with no flicker, markings stop at junctions, buildings stand on the ground, the OSM credit is visible.
- [ ] **Step 6: Commit** (`feat(world): render district from district.json`)

---

### Task 8: Drivetrain model and input

**Files:**
- Create: `src/vehicle/drivetrain.ts`, `src/vehicle/input.ts`
- Test: `src/vehicle/drivetrain.test.ts`, `src/vehicle/input.test.ts`

**Interfaces:**
- Produces:
  - `interface Controls { throttle: number; brake: number; clutch: number; steer: number; handbrake: boolean; shiftUp: boolean; shiftDown: boolean; ignition: boolean }` (throttle, brake and clutch 0–1, steer −1 left to +1 right; shift and ignition are edge-triggered for one frame)
  - `type Gearbox = 'manual' | 'auto'`
  - `interface DrivetrainState { gearbox: Gearbox; gear: number; rpm: number; running: boolean }` (gear −1 reverse, 0 neutral, 1–5)
  - `engineTorque(rpm: number): number` in Nm
  - `stepDrivetrain(s: DrivetrainState, c: Controls, wheelSpeed: number, dt: number): { state: DrivetrainState; wheelForce: number }` (wheelSpeed in m/s, signed; wheelForce in N at the contact patch, summed for both driven front wheels)
  - `readControls(keys: ReadonlySet<string>, pads: readonly (Gamepad | null)[], prev: Controls): Controls`

Values (Cobalt 1.5, approximate, fine for gameplay): idle 800 rpm, redline 6200, stall below 500. Torque curve by linear interpolation through (800, 95), (2000, 120), (4000, 134), (5600, 128), (6200, 110) Nm, and 0 above 6500. Gear ratios 1st 3.58, 2nd 2.02, 3rd 1.35, 4th 0.98, 5th 0.81, reverse 3.31, final drive 4.18, wheel radius 0.31 m, 85% driveline efficiency. Clutch: engaged fraction = 1 − clutch pedal. When engaged above 0.8 the rpm is locked to wheel rpm; if that rpm drops below 500 with the engine running, it stalls (`running = false`). Below 0.8 the rpm moves toward a throttle-driven free rev and transmitted torque scales with the engaged fraction. Auto: clutch always handled internally, upshift at 2600 rpm under part throttle / 5500 at full throttle, downshift at 1300, never stalls, reverse selected by holding brake at a standstill for 0.4 s.

Keyboard: W/↑ throttle, S/↓ brake, A/← D/→ steer (steer ramps at 3/s, returns at 5/s), Space handbrake, LeftShift clutch (manual), E/Q shift up/down, I ignition, G toggles gearbox in the menu only (not in this milestone). Gamepad (standard mapping): axes[0] steer, buttons[7] throttle, buttons[6] brake, buttons[4] clutch, buttons[5] handbrake, buttons[3]/[2] shift up/down, buttons[9] ignition. Pad values override keyboard only when non-zero.

- [ ] **Step 1: Failing tests:**
  - `engineTorque(4000) === 134`, `engineTorque(3000)` between 120 and 134, `engineTorque(7000) === 0`
  - Manual, 1st gear, clutch fully released at 0 m/s, throttle 0: next state `running === false` (stall)
  - Manual, 1st gear, clutch held then released while wheelSpeed = 3 m/s: rpm ≈ 3 / 0.31 × 3.58 × 4.18 × 60 / 2π ≈ 1380 (±20), `running === true`, `wheelForce > 0` with throttle 1
  - Neutral: `wheelForce === 0` at any throttle
  - Auto at 20 m/s, throttle 0.4: gear is 3 or higher after 2 s of steps at dt 1/60
  - Not running: `wheelForce === 0`, and `ignition: true` with clutch held or in neutral sets `running: true`, rpm 800
  - `readControls` with keys `{KeyW}` and `pads: [null]` gives throttle 1. With a pad whose buttons[7].value is 0.5 and no keys, throttle 0.5. Then the same call with `pads: [null]` (disconnected) and no keys gives throttle 0.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(vehicle): drivetrain model and input mapping`)

---

### Task 9: Vehicle physics and collisions

**Files:**
- Create: `src/vehicle/vehicle.ts`, `src/vehicle/carModel.ts`, `src/physics/world.ts`, `src/physics/loop.ts`
- Test: `src/physics/loop.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `stepDrivetrain`, `readControls`, `nearestLane`, `DistrictData`.
- Produces:
  - `createPhysics(d: DistrictData): Promise<{ world: RAPIER.World }>`: `await RAPIER.init()`, gravity −9.81, a ground cuboid covering bounds, and one fixed convex-hull or polyline-extruded collider per building (use `ColliderDesc.convexHull` for convex footprints, otherwise a trimesh of the extruded footprint)
  - `class Vehicle { constructor(world, spawn: { position: Vec2; heading: number }); update(c: Controls, dt: number): void; reset(spawn): void; get speed(): number; get drivetrain(): DrivetrainState; readonly object: THREE.Group }`, using `world.createVehicleController(chassis)` with 4 wheels at (±0.74, −0.25, ±1.31), suspension rest 0.3 m, stiffness 30, damping 4.4/2.3 compression/relaxation, front-wheel drive and steering, max steer 0.6 rad scaled by 1 / (1 + speed/12), brake force 4500 N per wheel, handbrake on the rear wheels only.
  - `fixedSteps(accumulator: number, dt: number, step = 1/60, maxSteps = 5): { steps: number; accumulator: number }`
- `carModel.ts`: a white Cobalt-like sedan built from primitives (body, glass cabin, roof, 4 wheels, head and tail lights) until M4 brings a free CC-BY model. Wheels visually spin and steer.
- Reset: R key, or the car's position leaving `bounds` by more than 20 m, or the car being upside down (up vector y < 0.2) for 2 s → `reset(nearestLane(...))`.

- [ ] **Step 1: Failing tests for `fixedSteps`:** dt 1/60 gives 1 step; dt 0.05 gives 3 steps with a remainder of about 0; dt 3.0 (tab was hidden) gives 5 steps and the accumulator is cleared to 0, not carried over.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** `fixedSteps`, physics world, `Vehicle`, and wire into `main.ts` (spawn at `nearestLane(d, 0, 0)`).
- [ ] **Step 4: Run tests, expect PASS.**
- [ ] **Step 5: Manual check:** in the browser, 0→60 km/h in auto takes about 10–13 s (a real Cobalt 1.5 does 0–100 in about 11.7 s). In manual, releasing the clutch with no throttle stalls; I restarts. Hitting a building at 50 km/h stops the car without passing through. Leaving the map resets you to a lane.
- [ ] **Step 6: Commit** (`feat(vehicle): rapier vehicle with drivetrain and building collisions`)

---

### Task 10: Cameras and mirrors

**Files:**
- Create: `src/camera/cameras.ts`, `src/camera/mirrors.ts`
- Test: `src/camera/cameras.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Vehicle.object`.
- Produces:
  - `type CameraMode = 'chase' | 'cockpit' | 'top'`, cycled with C
  - `chaseOffset(heading: number, speed: number): { back: number; up: number }`: back 7 m + speed × 0.05 (max 10), up 2.8 m
  - `createMirrors(renderer, scene, car): { update(): void; dispose(): void }`: three mirror cameras (left, right, rear-view) rendering into 256×128 render targets at half the main frame rate. In cockpit view they're shown as textured quads at the real mirror positions. In chase/top they're shown as a HUD strip at the top of the screen. Mirror images are horizontally flipped.
- Cockpit: driver's head at (−0.35, 1.2, −0.1) relative to the car (left-hand drive), mouse drag looks around ±100° yaw, ±30° pitch, recentres on release.

- [ ] **Step 1: Failing test:** `chaseOffset(0, 0)` gives back 7; `chaseOffset(0, 100)` gives back 10.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Manual check:** in cockpit view the left mirror shows the road behind on the left, flipped like a real mirror. With mirrors on, the frame rate drops less than 15%.
- [ ] **Step 6: Commit** (`feat(camera): chase, cockpit and top cameras with live mirrors`)

---

### Task 11: HUD and performance check

**Files:**
- Create: `src/ui/Hud.tsx`, `src/ui/hudStore.ts`, `src/ui/mount.tsx`
- Test: `src/ui/hudStore.test.ts`
- Modify: `src/main.ts`, `CREDITS.md`

**Interfaces:**
- Consumes: `Vehicle.speed`, `Vehicle.drivetrain`, `nearestLane` (for the street name), renderer info.
- Produces: `createHudStore(): { set(p: Partial<HudState>): void; subscribe(fn: () => void): () => void; get(): HudState }` with `HudState = { speedKmh: number; gear: string; rpm: number; running: boolean; gearbox: Gearbox; street: string; fps: number; drawCalls: number }`. The game loop writes at most 10 times a second. React reads via `useSyncExternalStore`. No Zustand needed.

HUD: speed (large, km/h), gear (R, N, 1–5, or D1–D5 in auto), a tachometer bar with red from 6000, a "STALLED, press I" note when not running, the current street name, a minimap like the spike's (rotating, roads and buildings, car arrow), FPS and draw calls behind a `?debug` flag. Controls help on first load, dismissed with H.

- [ ] **Step 1: Failing tests:** `set` notifies subscribers once per call; after unsubscribe, no further notifications; `get()` returns the merged state.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Performance check:** `npm run build && npx vite preview`, open with `?debug` in Chrome on a laptop with integrated graphics at 1080p, drive the main avenue loop for 2 minutes. Record min and average FPS, draw calls, and the total transfer size from the Network tab in `docs/perf/m1.md`. Pass: average ≥ 60, transfer < 30 MB. If FPS fails, first move shadows to 1024 and cut shadow distance, then lower tree density, and record what changed.
- [ ] **Step 6: Commit** (`feat(ui): HUD with speed, gear, tach, street, minimap`)

---

## Done when

- All `npm test` tests pass and `npm run build` succeeds.
- You can drive from Amir Temur square along the main avenues in manual and auto, stall and restart, use mirrors in cockpit view, reset with R, and never pass through a building.
- `docs/perf/m1.md` records a pass, or a stated shortfall with what was tried.
- `spike/` can be deleted (keep it until this list is green).
