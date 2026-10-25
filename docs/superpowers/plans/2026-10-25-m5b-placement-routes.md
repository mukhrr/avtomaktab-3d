# M5b, Sign Placement and Routes, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signs stand where Tashkent's rules put them, every one of the 297 catalogue entries is met on at least one exam route, and the game offers several routes: drawn at random in the exam, chosen freely in free driving with directions but no scoring.

**Architecture:** The city pipeline gains a rule-based placer that derives signs from road kinds, speed limits, one-way streets, junctions, zebras and mapped schools, car parks and hospitals, merged under the hand-placed signs. A hand-authored coverage file adds the remaining entries on route streets, checked by a placement helper so no sign contradicts a route. A coverage module computes which entries each route passes; a test fails the build if any entry is on no route. Routes become a list; the session takes a route per drive.

**Tech Stack:** TypeScript 5.6, three 0.169, React HUD, Vitest 2.1, tsx tools.

**Spec:** `docs/superpowers/specs/2026-10-25-m5-road-signs-design.md` (Goals 3 and 4, "Several exam routes", "Route choice", "Route count and district size"). M5a decisions: `docs/superpowers/plans/2026-10-25-m5a-sign-set-decisions.md`.

## Global Constraints

- Uzbek sign numbers everywhere. Rules text: https://lex.uz/uz/docs/-5953883.
- Settlement speed limits (clause 78): 60 km/h in Tashkent, 30 km/h near signed schools, 20 km/h in residential zones.
- Prohibition signs 3.16, 3.20, 3.22, 3.24 and 3.26 to 3.30 hold until the nearest intersection after the sign; 3.10 and 3.27 to 3.30 apply only to their side of the road. Warning signs stand 50 to 100 m before the hazard in a settlement.
- At most 3 signs per pole, plates not counted. Poles at least 15 m apart on one side unless the rules put signs together.
- Hand-placed signs win over rule-derived ones at the same spot. Coverage placements carry `origin: "coverage"`.
- At most 6 exam routes. New routes 4 to 8 km. Route-1 stays as it is (the exam run tests depend on it).
- The district may grow in any direction the routes need, as long as load stays under 3 s on the Mac and the M4 frame budgets hold (8 ms high, 120 main-pass draw calls).
- In the exam the route is drawn at random. In free driving any route can be chosen and its directions followed without scoring.
- Signs add at most 4 draw calls in total.
- Commits in Mukher's name only, never a `Co-Authored-By` line or a "Generated with Claude Code" line. Never push.

## Where this plan narrows the spec (Claude's calls, for Mukher to check)

- **Direction signs with real destination names** (spec Goal 3) are deferred. Each name needs its own texture cell and text layout, which is a feature of its own. In M5b, 5.20.x and similar signs appear as coverage signs with the catalogue's sample names.
- **"Crossing ahead" warnings where a zebra is hidden** are left out. The map data says nothing about visibility, so any rule would be a guess. The 1.20 warning still appears as a coverage sign.
- **"Which signs you have not met yet" in the debrief** (spec, Route choice) moves to M5c with the other learning aids. M5b provides `entriesOnRoute`, which it will use.

## Review Focus

1. A coverage or rule sign that forbids what a route does at that spot (no entry on a route edge, a turn ban where the route turns, a mandatory direction against the route's manoeuvre): the route must stay legal. Test in Task 4 (`routeConflicts`) and Task 6 (whole-district check).
2. A rule-derived sign landing in the same spot as a hand-placed one, or pushing a pole past 3 signs: the hand sign stays, the rule sign moves or drops, the build does not fail. Test in Task 2.
3. Free driving with a route reaches the finish or the player leaves the route: no debrief, no penalty voice, the game returns to plain free driving. Test in Task 3.
4. The exam's random draw with one route, or a route file that fails to load: the exam still starts on route-1, with one logged error. Test in Task 3.
5. A sign the coverage counts as "met" must be visible from the route: it stands on a lane the route drives, facing the driver, or on an approach to a junction the route passes through. Test in Task 5.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/district.ts` | `GraphEdge.kind`; `Poi` and `DistrictData.pois` |
| `tools/city/extract.ts` | Keeps road kind on edges; extracts schools, car parks, hospitals as POIs |
| `tools/city/signRules.ts` | Rule-derived placement, one function per rule, and the merge under hand signs |
| `tools/city/build.ts` | Calls the placer; loads `coverage.json`; validation tweak for 3.1 |
| `src/exam/routes.ts` | Route list loading and the random draw |
| `src/exam/session.ts` | Route per drive; scored or unscored |
| `src/ui/StartScreen.tsx`, `src/i18n/*.json` | Route choice in free driving |
| `src/exam/coverage.ts` | Which catalogue entries a route passes |
| `tools/signs/coverageSpots.ts` | Free spots along routes and `routeConflicts` for authoring coverage |
| `data/districts/tashkent-center/coverage.json` | Hand-authored coverage signs |
| `data/districts/tashkent-center/routes/*.waypoints.json`, `routes/index.json` | Routes |

---

### Task 1: Road facts for placement

**Files:**
- Modify: `src/shared/district.ts`, `tools/city/extract.ts`, `tools/city/graph.ts`, `tools/city/build.ts`, `src/world/testDistrict.ts`, `src/traffic/testNetwork.ts` (fixtures gain `kind`)
- Test: `tools/city/extract.test.ts`, `tools/city/graph.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // GraphEdge gains:
  kind: string;            // OSM highway value of its road, e.g. 'primary', 'living_street'
  type PoiKind = 'school' | 'kindergarten' | 'parking' | 'hospital' | 'fuel';
  interface Poi { id: string; kind: PoiKind; position: Vec2 }   // polygon POIs use their centroid
  // DistrictData gains: pois: Poi[]
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps the road kind on every graph edge', () => { /* mini.osm.xml fixture: an edge from a 'primary' way has kind 'primary' */ });
it('extracts schools, kindergartens, car parks and hospitals as POIs at their centroid', () => { /* fixture with a school way and a parking node -> 2 pois, school position = polygon centroid */ });
```

Add a school way and a parking node to `tools/city/fixtures/mini.osm.xml` if it has none.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tools/city` — Expected: FAIL on the two new tests.

- [ ] **Step 3: Implement**

Tags: `amenity=school|kindergarten|parking|hospital|fuel`, on nodes or closed ways. Rebuild with `npm run city:build -- tashkent-center`; the only `district.json` changes are `kind` on edges and the new `pois` array.

- [ ] **Step 4: Run the suite**

Run: `npx tsc --noEmit && npx vitest run` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(city): road kind on graph edges and school, parking, hospital POIs"
```

---

### Task 2: Rule-derived signs

**Files:**
- Create: `tools/city/signRules.ts`, `tools/city/signRules.test.ts`
- Modify: `tools/city/build.ts` (call the placer after `validateSigns` on hand signs; validate the merged list), `src/world/signs.ts` only if a new code needs nothing new (it should not)
- Test: `tools/city/signRules.test.ts`, `tools/city/build.test.ts`

**Interfaces:**
- Consumes: `GraphEdge.kind`, `Poi` (Task 1); `CODE`, `entry` (`src/shared/signCatalogue.ts`); `signSpots`, `signPose` (`src/world/signMount.ts`); `Crossing`, `controllers` from `DistrictData`.
- Produces:
  ```ts
  type RuleInput = Pick<DistrictData, 'graph' | 'crossings' | 'controllers' | 'pois'>;
  function speedSigns(d: RuleInput): Sign[];
  function residentialZoneSigns(d: RuleInput): Sign[];
  function oneWaySigns(d: RuleInput): Sign[];
  function prioritySigns(d: RuleInput): Sign[];
  function crossingSigns(d: RuleInput): Sign[];
  function poiSigns(d: RuleInput): Sign[];
  function placeRuleSigns(d: RuleInput, hand: Sign[], log?: (m: string) => void): Sign[];   // hand + rule, merged
  ```
  Every rule sign has `origin: 'rule'` and a deterministic id `<rule>-<edgeId>-<dir>-<at rounded to 0.1>`.

The rules (Claude's calls, from the spec and the Rules text):

| Rule | Sign | Where |
|---|---|---|
| Speed | 3.24 with the edge's `maxspeed` | 10 m after the start of every edge (in each travel direction with lanes) whose `maxspeed` is not 60 and whose kind is not `living_street` or `service`. Repeated per edge because the zone ends at each junction. |
| Residential zone | 5.38 / 5.39 | 5.38 at 5 m into a `living_street` edge entered from a non-`living_street` edge; 5.39 at 5 m before its end where the next edge is not `living_street`. |
| One way | 5.5 / 3.1 | 5.5 at 10 m into a one-way edge (`lanesBackward === 0`) entered from a junction; 3.1 at 3 m from the one-way edge's end node, on `dir: -1` (facing traffic that would enter against the flow). |
| Priority | 2.1 / 2.4 | At an unsignalled junction (no controller at the node) with 3 or more edges: rank kinds primary 5, secondary 4, tertiary 3, residential and unclassified 2, living_street and service 1 (and `_link` as its base). When the top rank is held by exactly two approaches, those get 2.1 and every lower-ranked approach gets 2.4, 15 m before the edge end. Equal ranks everywhere: no sign. |
| Crossing | 5.16.2 / 5.16.1 | At every zebra crossing: 5.16.2 on the right at the near edge of the crossing for each direction with lanes; also 5.16.1 on the left when that direction has 2 or more lanes. |
| Children | 1.21 | For each school or kindergarten within 60 m of an edge: on that edge in each direction with lanes, 75 m before the point of the edge nearest the POI, clamped to the edge start. |
| Parking | 6.4 | At the point of the nearest non-`service` edge within 40 m of a parking POI, right side, both directions. |
| Hospital | 6.1 | Same as parking, for hospitals, within 80 m. |

Merge: hand signs first. A rule sign is dropped when a hand sign of the same code stands within 15 m on the same edge, direction and side. If adding a rule sign would put a fourth sign on a spot, move it 15 m further along travel; if that leaves the edge, drop it and log one line. Two rule signs of the same code within 15 m: keep the first.

Validation change: `validateSigns` allows a sign to face a direction with no lanes only for code 3.1.

- [ ] **Step 1: Write the failing tests**

```ts
it('puts a speed limit after the start of each non-60 edge, both directions', () => { /* two-way edge maxspeed 40 -> two 3.24 value 40 at at=10 and at=len-10 */ });
it('places no speed sign on 60 km/h roads', () => { /* maxspeed 60 -> none */ });
it('brackets a living street with 5.38 and 5.39', () => {});
it('starts a one-way edge with 5.5 and ends it with 3.1 facing against the flow', () => { /* 3.1 has dir -1 and at = len - 3 */ });
it('gives the major road 2.1 and the minor approaches 2.4 at an unsignalled junction', () => { /* primary-primary-residential T: 2 x 2.1, 1 x 2.4 at len-15 */ });
it('puts no priority signs where all approaches rank equal', () => {});
it('skips signalled junctions', () => {});
it('marks a zebra with 5.16.2, and 5.16.1 on multi-lane directions', () => {});
it('warns of children 75 m before a school', () => {});
it('keeps a hand sign and drops the rule sign of the same code within 15 m', () => {});
it('moves a rule sign 15 m on when its spot already holds 3 signs', () => {});
it('drops and logs a rule sign that would move off the edge', () => {});
it('gives rule signs stable ids', () => { /* placeRuleSigns twice -> same ids */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tools/city/signRules.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Rebuild and check**

Run: `npm run city:build -- tashkent-center` — Expected: it logs counts per rule and the number moved and dropped. Run `npx tsc --noEmit && npx vitest run` — Expected: all pass, the exam-run tests included. If an exam-run test changes outcome because the AI or examiner now meets a new 2.1, 2.4, 3.1 or 3.24, stop and report it rather than editing the test.

- [ ] **Step 5: Look at it in the game**

With the dev server on 5173, drive route-1's first 1 km in `?debug` and take `docs/visuals/m5b/rule-signs-1.jpg` and `rule-signs-2.jpg` at a priority junction and at a one-way street. Check the chase-view draw calls at the spawn on high are unchanged (the two sign meshes are instanced).

- [ ] **Step 6: Commit**

```bash
git add tools/city public/districts docs/visuals/m5b
git commit -m "feat(city): rule-derived signs for speed, one-way, priority, crossings, schools, parking"
```

---

### Task 3: Several routes, random in the exam, free choice in free driving

**Files:**
- Create: `src/exam/routes.ts`, `src/exam/routes.test.ts`, `data/districts/tashkent-center/routes/index.json`
- Modify: `src/exam/session.ts`, `src/main.ts`, `src/ui/StartScreen.tsx`, `src/ui/choices.ts`, `src/i18n/uz.json`, `src/i18n/ru.json`, `tools/exam/route.ts` (build every route in the index; `npm run exam:route -- tashkent-center` with no id builds all)
- Test: `src/exam/routes.test.ts`, `src/exam/session.test.ts`, `src/ui/choices.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // routes/index.json: { routes: string[] }   e.g. ["route-1"]
  function loadRoutes(district: string, fetchJson?: (url: string) => Promise<unknown>): Promise<ExamRoute[]>;   // skips a route that fails to load, logs once; route-1 failing is fatal
  function drawRoute(routes: ExamRoute[], rand: () => number): ExamRoute;
  // Session
  start(lang: Lang, gearbox: Gearbox, route: ExamRoute, scored: boolean): void;
  get scored(): boolean;
  // StartChoice gains: route: string | null   (free driving only; null = no route)
  ```

Unscored drive: the examiner gives directions as usual, violations are neither voiced, toasted nor kept, there is no debrief, and reaching the finish or abandoning ends the session and returns to plain free driving with a toast (`route.finished` / `route.left`). Leaving the route works as in the exam (re-plan), so a learner who leaves it is guided back.

- [ ] **Step 1: Write the failing tests**

```ts
it('draws each route with the right probability', () => { /* 3 routes, rand 0.1/0.5/0.9 -> routes 0,1,2 */ });
it('starts the exam on route-1 when it is the only route', () => {});
it('skips a route that fails to load and logs once', async () => {});
it('drops violations in an unscored drive and ends without a result', () => { /* session.start(..., false); a red-light violation frame -> no penalty, onEnd not called with a result; at finish onFreeEnd fires */ });
it('remembers the free-driving route choice', () => { /* saveChoice({ ..., route: 'route-1' }) round trip; unknown id -> null */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/exam/routes.test.ts src/exam/session.test.ts src/ui/choices.test.ts` — Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

`main.ts` loads the index and all routes at start-up beside the district, as today for route-1; `routeKm` on the start screen shows the chosen route's length in free driving and "4-8 km" style range text in the exam. The minimap's route line follows the active route.

- [ ] **Step 4: Run the suite and check in the game**

Run: `npx tsc --noEmit && npx vitest run` — Expected: all pass. In `?debug`, start a free drive on route-1, follow two directions, run a red light: no penalty voice. Start an exam: it still works as before.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(exam): route list, random route in the exam, guided unscored routes in free driving"
```

---

### Task 4: Authoring helpers for coverage

**Files:**
- Create: `tools/signs/coverageSpots.ts`, `tools/signs/coverageSpots.test.ts`
- Modify: `tools/city/build.ts` (load `data/districts/<d>/coverage.json` when present, validate it with the others, merge after rule signs with the same merge rules), `package.json` (script `signs:spots`)

**Interfaces:**
- Consumes: `placeRuleSigns` (Task 2), `planRoute` (`src/exam/route.ts`), `LaneNetwork`.
- Produces:
  ```ts
  interface FreeSpot { edgeId: string; dir: 1 | -1; side: 'right' | 'left'; at: number; routeIds: string[]; beforeJunction: number }   // metres to the edge end
  function freeSpots(d: DistrictData, routes: ExamRoute[], spacing?: number): FreeSpot[];   // spacing default 15
  function routeConflicts(sign: Sign, routes: ExamRoute[], net: LaneNetwork, d: DistrictData): string[];   // human-readable reasons, empty when legal
  ```
  `npm run signs:spots -- tashkent-center` prints free spots per route and, for every coverage sign, its conflicts.

`routeConflicts` flags, for car-relevant entries only (`entry(code).carRelevant`): 3.1 or 3.2 governing a lane a route drives; 3.18.1, 3.18.2 or 3.19 at a junction where a route turns that way from that approach; 4.1.x or 4.3 at a junction where a route's manoeuvre from that approach is not one the sign allows; 3.24 with a value below 20; 4.7 with a value above 40; 3.20 or 3.22 (no overtaking) are fine; 3.27 to 3.30 are fine (the route never stops there). Other prohibitions on the car (3.3 to 3.9, 3.11 to 3.17) are flagged when the Gentra would be bound by them (mass 1.3 t, height 1.45 m, width 1.74 m, length 4.48 m). The table of allowed manoeuvres per 4.1.x code goes in the file as data, taken from the catalogue meanings.

- [ ] **Step 1: Write the failing tests**

```ts
it('lists free spots along a route at 15 m spacing, avoiding existing poles', () => {});
it('flags a no-entry on a lane the route drives', () => {});
it('flags a no-left-turn where the route turns left', () => {});
it('flags a straight-only sign where the route turns right', () => {});
it('does not flag a truck-only ban for the Gentra', () => { /* 3.4 value 3.5 */ });
it('flags a height limit lower than the Gentra', () => { /* 3.13 value 1.4 */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tools/signs/coverageSpots.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run them**

Run: `npx vitest run tools/signs` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "build(signs): free spots and route-conflict checks for coverage placements"
```

---

### Task 5: Which signs a route passes

**Files:**
- Create: `src/exam/coverage.ts`, `src/exam/coverage.test.ts`

**Interfaces:**
- Consumes: `ExamRoute`, `LaneNetwork`, `Sign`.
- Produces:
  ```ts
  function signsOnRoute(d: DistrictData, route: ExamRoute): Sign[];     // signs the driver passes, in route order
  function entriesOnRoute(d: DistrictData, route: ExamRoute): Set<string>;   // catalogue numbers incl. plates
  function missingEntries(d: DistrictData, routes: ExamRoute[]): string[];   // numbers on no route
  ```

A sign counts for a route when it stands on a lane step of the route (same edge and direction) between the start and finish positions, or when it is a junction sign (within 40 m of the edge end, the same reach as `SignSystem.atJunction`) on an approach edge to a junction node the route passes through, facing toward that node. Plates count with their sign.

- [ ] **Step 1: Write the failing tests**

```ts
it('counts a sign on a lane the route drives', () => {});
it('does not count a sign on the opposite direction of a route edge', () => {});
it('counts a no-entry on a side street at a junction the route crosses', () => {});
it('does not count a sign before the start or after the finish', () => {});
it('counts the plates under a counted sign', () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/exam/coverage.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run them**

Run: `npx vitest run src/exam/coverage.test.ts` — Expected: PASS. Print `missingEntries` for tashkent-center with route-1 and record the count in the report.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(exam): which catalogue entries each route passes"
```

---

### Task 6: New routes and coverage placements

**Files:**
- Create: `data/districts/tashkent-center/routes/route-2.waypoints.json` … up to `route-6`, `data/districts/tashkent-center/coverage.json`, `public/districts/tashkent-center/routes/route-*.json`
- Modify: `data/districts/tashkent-center/routes/index.json`, `data/districts/tashkent-center/district.config.json` (only if the district must grow), `public/districts/tashkent-center/district.json`
- Test: `src/exam/coverage.district.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: routes and coverage signs such that `missingEntries(district, routes)` is empty.

How to author (Claude's calls):
- Design routes like real exam routes: start and finish on a quiet street, a mix of signalled and unsignalled junctions, left and right turns, a U-turn where legal, at least one zebra. Each new route 4 to 8 km, starting with a straight lane (the route tool warns otherwise).
- Prefer streets where the rule signs already supply entries. Then place coverage signs from `npm run signs:spots`, in catalogue order, group by group, at plausible spots: warning signs 50 to 100 m before a junction or bend; prohibitions just after a junction (their zone runs to the next one); plates under a sign they can qualify (7.1.x distance under a warning sign, 7.4.x vehicle type under a prohibition, 7.5.x days and times under 3.27 to 3.30); service signs 6.x near a building edge; information signs 5.x where their meaning fits (5.15.x lanes on multi-lane approaches, 5.20.x before major junctions, 5.24/5.25 at district entry edges).
- Spread coverage across routes so each route carries a share; no route carries more than 60 coverage signs.
- Every coverage sign passes `routeConflicts` with an empty list. Run `npm run signs:spots` until it prints no conflicts.
- Grow the district only if streets run out; refetch with `npm run city:fetch` and record the new bbox and the load time.

- [ ] **Step 1: Write the failing test**

```ts
it('meets every catalogue entry on at least one route', async () => {
  expect(missingEntries(district, await allRoutes())).toEqual([]);
});
it('has between 2 and 6 routes, new ones 4 to 8 km', () => {});
it('has no coverage sign that conflicts with a route', () => { /* routeConflicts empty for every sign with origin 'coverage' or 'rule' */ });
it('keeps every pole at 3 signs or fewer and 15 m spacing on one side', () => {});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/exam/coverage.district.test.ts` — Expected: FAIL listing the missing entries.

- [ ] **Step 3: Author routes and coverage until the test passes**

Rebuild after each batch: `npm run city:build -- tashkent-center && npm run exam:route -- tashkent-center`.

- [ ] **Step 4: Run the suite and check in the game**

Run: `npx tsc --noEmit && npx vitest run` — Expected: all pass. In `?debug`, start a free drive on each new route and drive its first kilometre. Take `docs/visuals/m5b/route-<n>-stack.jpg` (a real stack of 2 or 3 signs with a plate) for at least two routes and `docs/visuals/m5b/route-<n>-overview.jpg` from the minimap. Measure: load time from page open to start screen, and chase-view draw calls on high at the spawn.

- [ ] **Step 5: Commit**

```bash
git add data/districts public/districts src/exam/coverage.district.test.ts docs/visuals/m5b
git commit -m "feat(exam): new routes and coverage signs so every sign is met"
```

---

### Task 7: Decisions and docs

**Files:**
- Create: `docs/superpowers/plans/2026-10-25-m5b-placement-routes-decisions.md`
- Modify: `README.md` (routes, free-driving route choice)

- [ ] **Step 1: Decisions doc**

Rulings from the ledger; counts of signs by origin (hand, rule, coverage) and by group; each route's length and its share of coverage signs; load time and draw calls measured in Task 6; anything deferred to M5c (the examiner reading the new signs, AI traffic obeying them, sign names in free driving).

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npx vitest run` — Expected: all pass.

```bash
git commit -am "docs: record M5b decisions"
```
