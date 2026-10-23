# Milestone 2: AI Traffic, Traffic Lights and Pedestrians Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Tashkent district comes alive. Traffic lights run real cycles (with the CIS flashing green and red+yellow), AI cars follow lanes, stop at red lights and for pedestrians, queue behind each other and behind the player, and take turns at unsignalled junctions. Pedestrians cross at zebras and signalised crossings and walk the sidewalks.

**Architecture:** The city pipeline gains crossings, edge-attached signals and signal controllers (phases) in `district.json`. At runtime, three pure, Three/Rapier-free simulations (`src/sim/signals.ts`, `src/traffic/trafficSim.ts`, `src/peds/pedSim.ts`) advance in the same fixed 1/60 s steps as the player car. Thin adapters render them with instanced meshes and mirror AI cars into Rapier as kinematic bodies, so the player physically collides with them. A small event bus reports player collisions for M3's examiner.

**Tech Stack:** as M1 (TypeScript 5.6, Vite 5.4, Vitest 2.1, three 0.169.0, @dimforge/rapier3d-compat 0.14.0, React 18.3.1). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-avtomaktab-3d-design.md` (Goals 3 "Living streets", rule engine needs in "Rule engine")
**Builds on:** M1 (`docs/superpowers/plans/2026-10-23-m1-drivable-district.md`), merged at `92b87bc`.

## Data facts this plan relies on (measured 2026-10-23 on `data/raw/tashkent-center.osm.xml`)

- 243 `highway=crossing` nodes, 224 on car roads. `crossing=` values: traffic_signals 109 (+1 `traffic_signals;marked`), zebra 29, uncontrolled 25, marked 8, unmarked 32, untagged 39.
- 82 `highway=traffic_signals` nodes, 77 on car roads, only 9 are graph nodes (junctions); the rest sit on edge interiors at stop lines. 6 have `traffic_signals:direction`.
- 474 graph junctions (3 or more edges), 15 roundabout ways, 9 stop/give_way nodes.

## Global Constraints

- Right-hand traffic. Edge direction `dir = 1` means travel from `edge.from` to `edge.to` (OSM way order); `dir = -1` the reverse. Distances along an edge (`at`, `s`) are metres from `edge.from` along `edge.points`.
- Signal sequence (CIS / Uzbekistan): green → flashing green 3 s (blinking at 1 Hz, 0.5 s on, 0.5 s off) → yellow 3 s → red. The next phase shows red+yellow during the 2 s all-red before its green.
- All simulations run inside the existing fixed 1/60 s step loop (`fixedSteps`, max 5 steps per frame). No `Math.random` in sim code: every random choice uses a seeded generator passed in, so tests are deterministic.
- AI car speeds come from `edge.maxspeed` (default 60 km/h city), scaled per driver by 0.85–1.0.
- Performance budget for this milestone: 60 AI cars and 120 pedestrians near the player, adding at most 15 draw calls total (instanced meshes).
- Code comments: only what the code can't say (see the user's global rules).

## Non-goals (deferred)

- Lane changes and overtaking. Agents keep their lane index through junctions (clamped to the lanes available).
- Left-turn yielding to oncoming traffic on green, and roundabout priority rules. Both go with the M3 sign/priority layer.
- Detecting player violations (red light, not yielding). That's the M3 rule engine; this milestone exposes the state it needs.
- Car and pedestrian art (M4). Cars are coloured boxes in 5 size classes; pedestrians are capsule figures.

## Review Focus

1. **Four cars arriving at an unsignalled junction at once:** reservations must never deadlock. A reservation older than 6 s is released and the next car goes. Pinned in Task 6.
2. **Player stopped or parked across a lane:** AI cars queue behind the player's car and never drive through it, including when the player is on a junction connector. Pinned in Task 6.
3. **Dead ends and one-way traps** (no allowed exit at a node): the agent U-turns on a two-way edge or is despawned. Its position never becomes NaN and it never freezes forever. Pinned in Task 4 and Task 6.
4. **Light turns yellow when a car is too close to stop** (needs more than 4 m/s² to stop): the car continues through instead of braking impossibly. Pinned in Task 6.
5. **Spawning:** never places an AI car or pedestrian within 2 car lengths of another car or of the player, and never in the player's view distance band below 100 m. Pinned in Task 6 and Task 7.

---

### Task 1: Crossings and edge attachment in the pipeline

**Files:**
- Modify: `src/shared/district.ts`, `tools/city/extract.ts`, `tools/city/graph.ts`, `tools/city/build.ts`
- Create: `tools/city/attach.ts`
- Modify fixture: `tools/city/fixtures/mini.osm.xml` (add a `highway=crossing` + `crossing=zebra` node inserted into way 100 between nodes 1 and 2, and a `highway=traffic_signals` node inserted into way 102)
- Test: `tools/city/attach.test.ts`, extend `tools/city/extract.test.ts`, `tools/city/graph.test.ts`

**Interfaces:**
- Produces (in `src/shared/district.ts`):
  - `GraphEdge.nodeIds: string[]` (OSM node ids, same length and order as `points`)
  - `type CrossingKind = 'signal' | 'zebra' | 'unmarked'`
  - `interface Crossing { id: string; position: Vec2; kind: CrossingKind; edgeId: string; at: number; width: number; controllerId?: string; walkPhase?: number }`
  - `DistrictData.crossings: Crossing[]`
- Produces (in `tools/city/attach.ts`):
  - `locateNode(edges: GraphEdge[], nodeId: string): { edgeId: string; at: number; index: number }[]` (every edge containing the node, with `at` = path length from `edge.from` to it)
  - `edgeLength(edge: GraphEdge): number`
- `extractFeatures` also returns `crossingNodes: { id: string; kind: CrossingKind }[]`. Mapping: `crossing` = traffic_signals or contains "traffic_signals" → signal; zebra, marked, uncontrolled → zebra; unmarked or untagged → unmarked. Only nodes that lie on car roads are kept.
- `buildDistrict` fills `crossings` with `width` = the edge width, `position` = the node position; crossings at graph nodes (junctions) attach to the first edge containing them.

- [ ] **Step 1: Failing tests:** `locateNode` on an edge with points `[[0,0],[10,0],[10,10]]` and nodeIds `['a','b','c']` returns `at` 0, 10 and 20 for a, b and c. A node at a junction returns one entry per touching edge. In the fixture build, the zebra crossing is on edge `100:0` with `at` between 0 and the edge length, `kind: 'zebra'`, `width: 7`. Every graph edge has `nodeIds.length === points.length`. `crossing=traffic_signals;marked` maps to `signal`.
- [ ] **Step 2: Run** `npx vitest run tools`, expect FAIL.
- [ ] **Step 3: Implement.** Make `buildRoadGraph` slice `roadNodeIds` into `edge.nodeIds`.
- [ ] **Step 4: Run, expect PASS** (all earlier tests too). `npm run city:build -- tashkent-center` prints a crossings count of about 224.
- [ ] **Step 5: Commit** (`feat(city): crossings attached to graph edges`)

---

### Task 2: Signal controllers and phases

**Files:**
- Create: `tools/city/controllers.ts`
- Modify: `src/shared/district.ts`, `tools/city/build.ts`, `src/world/signals.ts` (place heads using the approach instead of `nearestLane`)
- Test: `tools/city/controllers.test.ts`
- Output (committed): rebuilt `public/districts/tashkent-center/district.json`

**Interfaces:**
- Produces (in `src/shared/district.ts`):
  - `interface Approach { edgeId: string; dir: 1 | -1; stopAt: number }`: a car travelling `dir` on `edgeId` must stop before passing `stopAt`
  - `interface SignalController { id: string; phases: Approach[][]; offset: number }` (`offset` = seconds into the cycle at t = 0, from `hash(id) % cycleLength`)
  - `Signal` gains `controllerId?: string; approach?: Approach`. Heads with no approach render dark.
  - `DistrictData.controllers: SignalController[]`
- Produces: `buildControllers(signals: { id: string; position: Vec2; direction?: 'forward' | 'backward' | 'both' }[], edges: GraphEdge[], nodes: GraphNode[], crossings: Crossing[]): { controllers: SignalController[]; signals: Signal[]; crossings: Crossing[] }`
- `extractFeatures` passes `traffic_signals:direction` through on signal nodes.

Rules:
1. **Clustering:** signals within 45 m of each other (union-find, single linkage) form one controller. The controller id is the smallest signal id in the cluster.
2. **Approaches per signal:**
   - On an edge interior with a direction tag: forward → dir 1, backward → dir −1, both → both dirs. `stopAt` = the signal's `at`.
   - On an edge interior with no tag: the direction heading toward the nearer edge end that is a junction (3+ edges), or both dirs if neither end is a junction. `stopAt` = the signal's `at`. Skip directions with 0 lanes (one-ways).
   - At a graph node: every edge arriving at that node (dir toward the node, lanes > 0), with `stopAt` = the junction trim distance before the node (use `junctionTrim` from `src/world/roadGeometry.ts`; it's pure and importable from tools).
3. **Phases:** compute each approach's travel bearing at `stopAt`. Phase 0 holds approaches whose axis (bearing mod 180°) is within 45° of the first approach's axis. Phase 1 holds the rest. Drop an empty phase 1, unless a signal crossing links to the controller (below), in which case it becomes a pedestrian-only phase `[]`.
4. **Signal crossings:** link to the nearest controller within 45 m that has an approach on the crossing's edge, with `walkPhase` = the first phase index that doesn't contain that edge (adding the `[]` phase if needed). With no such controller, create a standalone controller `ped-<crossingId>` with phases `[[edge both dirs, stopAt = at − 3 for dir 1 and at + 3 for dir −1], []]` and `walkPhase: 1`.
5. Durations live in `src/sim/signals.ts` (Task 3); the pipeline stores only `offset`, with the cycle length computed by the same exported `cycleLength(phaseCount)`.

- [ ] **Step 1: Failing tests** with hand-built edges, a 4-arm cross at node `c` with arms N/E/S/W of 60 m, two-way, 2 lanes:
  - Four signals 20 m before `c` on each arm, untagged → 1 controller with 2 phases. N and S arms are in one phase, E and W in the other. Every approach dir points toward `c`, and `stopAt` equals each signal's `at`.
  - Two signals 200 m apart → 2 controllers.
  - A signal on a oneway arm (`lanesBackward: 0`) whose nearer junction would need dir −1 → no approach in the disallowed direction.
  - A signal at node `c` itself → 4 approaches with `stopAt` = edge length − trim.
  - A signal crossing 10 m from the N-arm signal → `controllerId` set and `walkPhase` = the E/W phase index.
  - A lone signal crossing → standalone controller `ped-<id>` with phases length 2 and `walkPhase: 1`.
  - `offset` is the same for the same id across two calls.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement and wire into `buildDistrict`.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Rebuild real data.** `npm run city:build -- tashkent-center` prints a controllers count. Expected: 30–60 controllers, and at least 70 of the 82 signals have an approach. Note both numbers in the commit message.
- [ ] **Step 6: Commit** (`feat(city): signal controllers with phases and crossing links`)

---

### Task 3: Signal timing at runtime

**Files:**
- Create: `src/sim/signals.ts`
- Test: `src/sim/signals.test.ts`

**Interfaces:**
- Produces:
  - `type LightState = 'green' | 'flashingGreen' | 'yellow' | 'red' | 'redYellow'`
  - `const GREEN = 18, FLASH = 3, YELLOW = 3, ALL_RED = 2, PED_ONLY_GREEN = 12` (seconds)
  - `phaseLength(phase: Approach[]): number` (vehicle phase = GREEN + FLASH + YELLOW + ALL_RED = 26; pedestrian-only `[]` phase = PED_ONLY_GREEN + FLASH + ALL_RED = 17)
  - `cycleLength(phases: Approach[][]): number`
  - `class SignalSystem { constructor(d: DistrictData); update(dt: number): void; time: number; approachState(edgeId: string, dir: 1 | -1, s: number): { state: LightState; stopAt: number } | null; headState(signalId: string): LightState | null; walkState(crossingId: string): 'walk' | 'flashingWalk' | 'dontWalk' | null; lampOn(state: LightState): boolean }`
  - `approachState` returns the nearest controlled stop line **ahead** of position `s` in direction `dir` on that edge (s < stopAt for dir 1, s > stopAt for dir −1), or null.
- Timeline for phase k inside the cycle (t_k = start of phase k): `[t_k, t_k+GREEN)` green, then flashingGreen for FLASH, then yellow for YELLOW, then red for ALL_RED. During the ALL_RED of phase k, approaches of phase k+1 show redYellow. Approaches not in the current phase are red. Walk: `walk` during the walkPhase's green, `flashingWalk` during its flash, otherwise `dontWalk`.

- [ ] **Step 1: Failing tests** with a hand-made controller (2 vehicle phases, offset 0): at t = 0, phase 0 is green and phase 1 red; at t = 19 phase 0 is flashingGreen; at t = 22 yellow; at t = 24.5 phase 0 red and phase 1 redYellow; at t = 26 phase 1 green. `cycleLength` = 52. With a `[]` ped phase and walkPhase 1: walk at the ped phase's start, flashingWalk 12 s later, dontWalk during phase 0. `approachState` from s = 5 with dir 1 and stopAt 20 returns that stop line; from s = 25 it returns null. `lampOn('flashingGreen')` is true at time 0.2 and false at 0.7. `offset` shifts the timeline.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** (index approaches per `edgeId:dir` at construction; no per-call scans of all controllers). **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(sim): traffic signal timing with CIS sequence`)

---

### Task 4: Lane paths and routing

**Files:**
- Create: `src/traffic/lanes.ts`, `src/traffic/testNetwork.ts` (hand-built `DistrictData` used by Tasks 4–8: all arms 7 m wide with 2 lanes unless stated; a 4-arm signalised cross at (0,0) with 120 m arms, a 3-arm unsignalled T at (240, 0) joined by the east arm, a 40 m dead-end two-way stub off the T, and one oneway pair; with a zebra crossing on the west arm and a controller on the cross)
- Test: `src/traffic/lanes.test.ts`

**Interfaces:**
- Consumes: `junctionTrim`, `trimEdge` (M1 `src/world/roadGeometry.ts`), shared types.
- Produces:
  - `interface LaneRef { edgeId: string; dir: 1 | -1; lane: number }` (lane 0 = rightmost)
  - `interface LanePath { ref: LaneRef; points: Vec2[]; length: number; startAt: number; endAt: number }`: centre line of the lane over the trimmed edge, ordered in travel direction; `startAt`/`endAt` are edge distances where the path starts and ends
  - `class LaneNetwork { constructor(d: DistrictData); path(ref: LaneRef): LanePath; exits(ref: LaneRef): LaneRef[]; connector(from: LaneRef, to: LaneRef): Vec2[]; edgeS(ref: LaneRef, pathS: number): number; pathS(ref: LaneRef, edgeS: number): number }` (paths and connectors cached)
  - `pointAt(points: Vec2[], s: number): { position: Vec2; heading: number }` (heading convention as M1: `atan2(dx, dz)`)
- Lane offset from the edge centreline, positive to the right of travel: `width/2 − (lane + 0.5) × width/(lanesForward + lanesBackward)` for the travel direction's side.
- `exits(ref)`: at the arrival node, every touching edge you can enter (dir chosen by which end touches the node, needing more than 0 lanes that way), excluding the edge you arrived on. If that leaves none and the arrival edge is two-way, return its reverse (U-turn). Otherwise return `[]` (the sim despawns the car). Lane = min(ref.lane, available − 1).
- `connector(from, to)`: a quadratic Bézier from the end of `from`'s path to the start of `to`'s path, with the control point at the intersection of the two tangent lines (fall back to the midpoint when they're near-parallel), sampled every 1 m, with at least 3 points.

- [ ] **Step 1: Failing tests:** the rightmost lane path on a 7 m, 2-lane two-way arm going east lies 7/2 − 0.5 × 3.5 = 1.75 m south of the centreline; `path().length` is about the trimmed edge length; `exits` from the west arm at the cross gives 3 refs and excludes the west arm; from the dead-end stub it gives the U-turn reverse; a oneway arrival with no exits gives `[]`; the connector's first and last points equal the path end and start, with no NaN; `pointAt` past the end clamps to the last point.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(traffic): lane paths, exits and junction connectors`)

---

### Task 5: Car-following model

**Files:**
- Create: `src/traffic/idm.ts`
- Test: `src/traffic/idm.test.ts`

**Interfaces:**
- Produces:
  - `interface DriverParams { v0: number; a: number; b: number; T: number; s0: number }`, with defaults `a = 1.5`, `b = 2.0`, `T = 1.4`, `s0 = 2.5`
  - `idmAccel(v: number, gap: number | null, leaderV: number, p: DriverParams): number` (Intelligent Driver Model; `gap` = bumper-to-bumper metres, null = free road). Clamp the result to [−9, a].
  - `canStopBefore(v: number, distance: number, maxDecel = 4): boolean` (v² / 2d ≤ distance)
  - `turnSpeed(angleRad: number): number`: 4.5 m/s for turns over 60°, 8 m/s for 25°–60°, Infinity below

Formula: `s* = s0 + max(0, v·T + v·(v − vL) / (2·√(a·b)))`, `acc = a·[1 − (v/v0)^4 − (s*/gap)^2]`.

- [ ] **Step 1: Failing tests:** free road from 0 m/s with v0 = 16.7 converges to within 0.3 m/s of v0 in 40 s of 1/60 steps; behind a stationary obstacle 80 m ahead, a car starting at 14 m/s stops with a final gap between 1.5 and 3.5 m and never goes negative; following a leader at a constant 10 m/s settles at about s0 + 10·T = 16.5 m (±1.5); `canStopBefore(14, 30)` is false and `canStopBefore(14, 60)` is true; `turnSpeed(Math.PI / 2) === 4.5`.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(traffic): intelligent driver model`)

---

### Task 6: Traffic simulation

**Files:**
- Create: `src/traffic/trafficSim.ts`, `src/sim/rng.ts` (move `rng` from `src/world/vegetation.ts` here and import it there)
- Test: `src/traffic/trafficSim.test.ts`

**Interfaces:**
- Consumes: `LaneNetwork`, `idmAccel`, `canStopBefore`, `turnSpeed`, `SignalSystem.approachState`, `rng`.
- Produces:
  - `interface PlayerState { position: Vec2; heading: number; speed: number; length: number; width: number }`
  - `type CarClass = 'spark' | 'nexia' | 'cobalt' | 'damas' | 'bus'` (lengths 3.6, 4.5, 4.5, 3.5, 11 m; widths 1.6, 1.7, 1.74, 1.5, 2.5; weights 25, 25, 30, 12, 8)
  - `interface AgentView { id: number; active: boolean; position: Vec2; heading: number; carClass: CarClass; colour: number; braking: boolean; speed: number }`
  - `interface CrossingOccupancy { occupied(crossingId: string): boolean }` (provided by Task 7; tests pass a stub)
  - `class TrafficSim { constructor(d: DistrictData, net: LaneNetwork, signals: SignalSystem, opts: { count: number; seed: number }); step(dt: number, player: PlayerState, crossings: CrossingOccupancy): void; readonly agents: readonly AgentView[]; reservationHolder(nodeId: string): number | null }`

Behaviour per step, for each active agent:
1. **Target speed** = edge maxspeed × driver factor (0.85–1.0 from rng), capped by `turnSpeed` on connectors and within 25 m before a connector.
2. **Choose next lane** when within 40 m of the path end (seeded choice from `exits`). With no exits, despawn when the end is reached.
3. **Obstacles ahead within 80 m lookahead**, along the current path, then the connector, then the next path. Take the nearest of:
   - (a) another agent in the same lane or connector ahead: gap = Δs − (lengths/2 sum), leader speed = its speed
   - (b) the player, if the player's centre projects onto the look-ahead polyline with lateral offset < (lane width/2 + player width/2) and is ahead: gap computed the same way, leader speed = max(0, player speed along path)
   - (c) a stop line from `approachState`: always when red or redYellow; when yellow only if `canStopBefore(v, distance)`; never for green or flashingGreen. The obstacle is at `stopAt − 1` (dir 1) or `stopAt + 1` (dir −1), speed 0
   - (d) a zebra or signal crossing on the path with `occupied(id)`: obstacle at `at ∓ 3`
   - (e) the path end of an unsignalled junction node (no approach from any controller ends there) whose reservation is held by another agent from a different approach: obstacle at path end
4. **Integrate** v += idmAccel·dt (no reversing; v ≥ 0), s += v·dt. Move onto the connector or the next path when s passes the end, carrying the remainder.
5. **Reservations:** an agent takes the reservation for an unsignalled junction node when it enters the connector, if free or held by an agent from the same approach (platoon). It releases on leaving the connector. Any reservation older than 6 s is force-released (Review Focus 1).
6. **Spawn/despawn:** keep `count` agents active. Despawn agents farther than 350 m from the player. Spawn on random lane positions 120–300 m from the player, at least 2 × 4.5 m from any agent or the player along the lane and in Euclidean distance (Review Focus 5). Initial fill on the first step uses 30–300 m. `speed` on spawn = 0.6 × target.
7. `braking` = acceleration < −1 m/s² (used for brake lights).

- [ ] **Step 1: Failing tests** on `testNetwork` with deterministic seeds:
  - **Red light:** one agent placed 60 m before the cross's stop line with its phase red stops between 0.5 and 4 m before `stopAt` and doesn't pass it while red. After the light turns green it passes within 6 s.
  - **Dilemma zone:** at 14 m/s, 10 m from the stop line when the state turns yellow, the agent continues through (Review Focus 4).
  - **Player obstacle:** the player stationary in the lane 50 m ahead of an agent → the agent stops behind with gap ≥ 1.5 m and never overlaps the player's bounding box over 20 s. Repeat with the player standing inside the cross on the connector path (Review Focus 2).
  - **Queue:** three agents in the same lane behind a red light keep gaps ≥ 1.5 m and preserve order.
  - **Unsignalled T:** two agents arriving from different arms at the same time never both hold or both occupy connectors of that node at once. Four agents arriving on all available approaches at the same time all pass within 30 s (no deadlock, Review Focus 1).
  - **Crossing occupancy:** with `occupied('z1') = true` an agent stops before the zebra, and goes once it becomes false.
  - **Dead end:** an agent driving into the stub U-turns and keeps moving, and no agent position is ever NaN over 120 s of a 20-agent run.
  - **Spawn:** over 60 s with count 30, every spawn is ≥ 100 m from the player and ≥ 9 m from every other agent; the active count stays at 30.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** Index agents per lane/connector each step for leader search (no O(n²) over all agents). **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(traffic): lane-following traffic with signals, queues and junction reservations`)

---

### Task 7: Pedestrian simulation

**Files:**
- Create: `src/peds/pedSim.ts`
- Test: `src/peds/pedSim.test.ts`

**Interfaces:**
- Consumes: `SignalSystem.walkState`, `TrafficSim.agents`, `PlayerState`, `rng`, `Crossing`, footway roads (`FOOT_KINDS`).
- Produces:
  - `interface PedView { id: number; active: boolean; position: Vec2; heading: number; colour: number; walking: boolean }`
  - `class PedSim implements CrossingOccupancy { constructor(d: DistrictData, opts: { crossers: number; walkers: number; seed: number }); step(dt: number, player: PlayerState, cars: readonly AgentView[], signals: SignalSystem): void; occupied(crossingId: string): boolean; hitTest(player: PlayerState): number[]; remove(id: number): void; readonly peds: readonly PedView[] }`

Behaviour:
- **Crossers** (default 40): spawn at a curb end of a crossing within 150 m of the player (curb end = crossing position ± perpendicular × (width/2 + 1.5)). They wait, then cross at 1.2–1.5 m/s and walk 15 m along the sidewalk before despawning.
  - signal crossing: go only on `walk` (not flashingWalk)
  - zebra: go when no AI car is within 2 s time-to-arrival of the crossing in either direction (the player is ignored on purpose, so the player must yield, which M3 will score)
  - unmarked: go when no car, AI or player, is within 4 s time-to-arrival
- **Walkers** (default 80): walk footway polylines within 200 m of the player at 1.1–1.5 m/s, turn back at the ends, and respawn when more than 250 m away.
- `occupied(id)`: some crosser is between the two curb ends of that crossing (on the carriageway).
- `hitTest(player)`: ids of pedestrians inside the player's oriented box grown by 0.3 m.

- [ ] **Step 1: Failing tests** on `testNetwork`:
  - A crosser at a signal crossing waits while dontWalk and starts within 0.5 s of walk.
  - A zebra crosser waits while an AI car is 15 m away at 12 m/s, and crosses when that car is 60 m away.
  - A zebra crosser crosses even when the player is 10 m away at 12 m/s.
  - `occupied` is true only while the crosser is on the carriageway.
  - `hitTest` reports a pedestrian standing at the player's front bumper and not one 2 m to the side.
  - Walkers stay on footway polylines (distance to the nearest footway < 0.5 m).
  - Walk speeds are all within 1.1–1.5.
  - Every crosser spawns at a curb end (never on the carriageway) of a crossing within 150 m of the player, and at least 9 m from the player.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** (`feat(peds): crossing and sidewalk pedestrians`)

---

### Task 8: Physics, events and rendering integration

**Files:**
- Create: `src/sim/events.ts`, `src/traffic/trafficBodies.ts`, `src/traffic/trafficView.ts`, `src/peds/pedView.ts`, `src/world/crossings.ts`
- Modify: `src/world/signals.ts` (return per-signal lamp indices; add pedestrian heads at signal crossings), `src/world/buildWorld.ts`, `src/vehicle/vehicle.ts` (enable collision events on the chassis collider, expose `collider`), `src/main.ts`, `src/ui/hudStore.ts` + `src/ui/Hud.tsx` (debug counts)
- Test: `src/sim/events.test.ts`, `src/traffic/trafficBodies.test.ts`

**Interfaces:**
- Produces:
  - `type GameEvent = { type: 'collision'; with: 'car' | 'building'; speed: number; time: number } | { type: 'pedestrianHit'; pedId: number; speed: number; time: number }`
  - `class EventBus { emit(e: GameEvent): void; on(fn: (e: GameEvent) => void): () => void; drain(): GameEvent[] }` (`drain` returns and clears events since the last drain; M3 consumes it)
  - `class TrafficBodies { constructor(world: RAPIER.World, count: number); sync(agents: readonly AgentView[]): void; isTrafficCollider(handle: number): boolean }`: one kinematic position-based cuboid per pool slot, sized per car class on activation, moved with `setNextKinematicTranslation/Rotation`, inactive slots parked at y = −100
  - `trafficView(scene, count)` and `pedView(scene, count)`: InstancedMesh per car class (body + cabin, per-instance colour, brake lights brighter when `braking`) and per pedestrian part (body capsule, head)
  - `addCrossings(scene, d)`: zebra stripes (0.5 m bars, 0.5 m gaps, across the full carriageway, length 3 m along the road) for zebra and signal kinds, and a 0.4 m solid stop line across the travel lanes at every approach `stopAt`. Merged into one mesh.
- Wiring in `main.ts`: build `SignalSystem`, `LaneNetwork`, `TrafficSim`, `PedSim`, `TrafficBodies`, and an `EventQueue`. Each fixed step: `signals.update`, `traffic.step`, `peds.step`, `bodies.sync`, then the car update and `world.step(eventQueue)`. Drain Rapier collision events where one collider is the chassis: emit `collision` with `car` (traffic collider) or `building`. Run `peds.hitTest`: emit `pedestrianHit` and `peds.remove(id)`. Each frame: update view instances and lamp colours (`headState` + `lampOn`).
- Debug HUD (`?debug`): active cars, active peds, signal controllers.

- [ ] **Step 1: Failing tests:** `EventBus.drain` returns emitted events once and then `[]`; `on` unsubscribe works. Headless Rapier: a `Vehicle` driven at 30 km/h into a `TrafficBodies` slot synced as a stationary Cobalt 25 m ahead → a collision event pair with the chassis is reported, `isTrafficCollider` is true for the other handle, and the player stops before passing through the car.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** all integration pieces. **Step 4: Run, expect PASS**, plus `npx tsc --noEmit`.
- [ ] **Step 5: Manual check in the browser:**
  - Lights at Amir Temur square cycle green → flashing → yellow → red, with red+yellow before green.
  - AI cars stop at red lights with no cars passing through each other.
  - Pedestrians cross at zebras, and AI cars wait for them.
  - Stopping your car in a lane makes cars queue behind you.
  - Driving into an AI car stops you and fires a `collision` event (log events to the console under `?debug`).
- [ ] **Step 6: Commit** (`feat: living streets with traffic, lights and pedestrians`)

---

### Task 9: Performance pass

**Files:**
- Modify: `docs/perf/m1.md` → rename to `docs/perf/README.md` with an M2 section; whatever code the measurements point at

- [ ] **Step 1: Measure** in a production build (`npm run build && npx vite preview`, `?debug`) with traffic at 60 cars and 120 peds: draw calls (budget: M1's 45 + 15), sim step time (wrap `traffic.step` + `peds.step` in `performance.now()` and show the 1-second average in the debug HUD; budget 2 ms), and download size.
- [ ] **Step 2: If over budget**, cut in this order: pedestrian walkers to 60, AI cars to 40, lookahead 80 → 60 m. Record what changed.
- [ ] **Step 3: Record** the numbers and, if the pane is still throttled, say that FPS needs the laptop check (same as M1).
- [ ] **Step 4: Commit** (`perf: M2 traffic budget check`)

---

## Done when

- `npm test` and `npx tsc --noEmit` pass.
- Driving around the district shows working light cycles, AI cars that queue at red lights and behind the player, pedestrians crossing at zebras and signalised crossings, and no AI cars stuck forever at any junction during 5 minutes of driving.
- Crashing into an AI car or hitting a pedestrian produces an event on the bus.
- Draw calls and sim time are recorded in `docs/perf/README.md`.
