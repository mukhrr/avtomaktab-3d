# M5b placement and routes: rulings, counts and deferred work

Collected from the build ledger when M5b finished. Road signs are now placed by rule from the map, six exam routes exist, every one of the 297 catalogue signs is met on at least one route, and free driving can be guided along a route without scoring.

## Rulings

- Ruling: the 3.24-below-20 and 4.7-above-40 checks in routeConflicts apply to coverage signs only; for rule signs the whole-district test checks manoeuvre conflicts (3.1, 3.2, 3.18.x, 3.19, 4.1.x, 4.3), rule 3.24 values mirror the mapped limit; cost if wrong: one test filter
- Ruling: parking uses 5.15 and hospital 6.2 (the plan's 6.4/6.1 were wrong codes; catalogue wins); cost if wrong: one constant
- Ruling: school zone limit is min(30, edge maxspeed) in speedLimitAt, and 1.21 is not placed on service or living_street edges, a school sign must never raise a limit; clause 78 sets 30 as a maximum; cost if wrong: fewer school warnings on yards
- Ruling: halves of a divided road (a one-way primary/secondary/tertiary edge with an opposite-direction one-way edge of the same name within 40 m) get no 5.5 and no 3.1, Tashkent marks one-way streets, not each carriageway of a divided road, and 574 one-way signs read as clutter; cost if wrong: fewer one-way signs on boulevards
- Ruling: service-road approaches get no 2.4, and a junction whose only lower-ranked approaches are service roads gets no 2.1, leaving a yard or car park already means giving way under the rules, without a sign; cost if wrong: fewer priority signs at driveways; behaviour unchanged (equal rank → existing right-hand rule)
- Ruling: accept priority deferring to hand signs within 40 m, wiring after controllers, and noEntry instead of wrongWayOneway for rule 3.1 (both 100-point fails)
- Ruling: minimap route line only on guided free drives, never in the exam, a real examiner gives directions, not a map; cost if wrong: one flag
- Ruling: unscored drives keep the start brief (belt, mirrors), useful practice; cost if wrong: one line skipped
- Ruling: 3.1 conflicts follow the examiner, on any step after the first, a 3.1 within NO_ENTRY_REACH of the edge entry is flagged regardless of the finish position, the tool must never pass what the examiner charges; cost if wrong: over-flagging a few spots
- Ruling: 3.35 eco zone is treated as binding the Gentra (its eco class is unmodelled) and flagged on driven lanes; it can still be met as a side-street junction sign; cost if wrong: one sign placed off-route
- Ruling: a sign off the route counts for a junction node the route passes when it stands within 40 m of that node on an edge the route does not drive there, and governs traffic ENTERING that edge from the node (dir leads away from the node), any code, that is the face a driver at the junction sees, and it matches the examiner's NoEntryRule; cost if wrong: coverage counts differ
- Ruling: routes are re-waypointed around double-turn micro-edges, the Srkver lane-dependent transition, and unprotected median lefts; a careful-driver examRun test per new route (with traffic as main.ts runs it) asserts pass, no noIndicator, no noMirrorCheck, finish under 1500 s, a randomly drawn route must be fair; cost if wrong: some coverage re-placed
- Ruling: 5.42 never on a route approach or any signalled approach a route drives; routeConflicts flags it; the right-on-red exception is M5c work; cost if wrong: one sign moved
- Ruling: 4.6.x path signs join the lane-ban check regardless of carRelevant; 5.22-5.25 and 3.25 are placed only where they do not change the limit the examiner applies (side edges, or 3.25 where no 3.24 governs on a 60 km/h edge); 5.19.1 dead end never on a through edge the route continues, signs on routes must not teach breaking a rule; cost if wrong: re-placement

## Signs in the district

865 signs stand in the built district.

| Origin | Count | By group |
|---|---|---|
| hand | 41 | 1: 1, 2: 20, 3: 4, 5: 16 |
| rule | 595 | 1: 12, 2: 59, 3: 151, 5: 368, 6: 5 |
| coverage | 229 | 1: 49, 2: 7, 3: 36, 4: 24, 5: 83, 6: 30 |

The coverage signs carry 61 plates (group 7). They are listed in `data/districts/tashkent-center/coverage.json`. The build merge places all 229 with 0 moved and 0 dropped, and `signs:spots` shows 0 conflicts with a route.

## Routes

| Route | Length | Coverage signs met | Careful driver, empty roads | Careful driver, with traffic |
|---|---|---|---|---|
| route-1 | 3.80 km | 10 | pass | pass |
| route-2 | 6.17 km | 59 | pass, 0 pts, 671 s | pass, 0 pts, 1089 s |
| route-3 | 6.05 km | 58 | pass, 10 pts (2x harshBraking), 675 s | pass, 0 pts, 887 s |
| route-4 | 5.68 km | 57 | pass, 0 pts, 721 s | pass, 0 pts, 1064 s |
| route-5 | 5.77 km | 57 | pass, 0 pts, 610 s | pass, 0 pts, 1035 s |
| route-6 | 5.77 km | 37 | pass, 0 pts, 656 s | pass, 20 pts (stoppedOnCrossing), 1148 s |

Route-1 is the M3 exam route and was not changed. Routes 2 to 6 were built by a lane walker that only uses moves a careful driver can follow, then checked with the scripted careful driver. No route has a noIndicator or noMirrorCheck finding. Each of routes 2 to 6 has its own careful-driver test with traffic, under 1500 s.

The exam draws one route at random. Free driving lets the player pick a route to be guided along (minimap line, no scoring) or none.

## Measured

- Draw calls at the spawn on high: 87, unchanged from M5a.
- Atlas: 2048 x 2656, 1.01 MB PNG, within the M5a budget.
- Load time: measured only in headless swiftshader, 15 to 17 s, unchanged. The 3 s target on Mukher's Mac is not measured.
- Frame time on Mukher's Mac is not measured.
- Tests: 105 files, 1067 tests passed after the last fix.

## Deferred minors

- Task 1: no fuel/kindergarten fixture coverage; amenity node that is also an amenity-way vertex would give two POIs
- Task 2: speedLimitAt lets any passed 3.24 override a 1.21 school zone regardless of order (0 cases now; may bite with coverage signs in Task 6, carry)
- Task 2: a sign moved 15 m is not re-checked for same-code duplicates
- Task 2: 5.16.1 should mark the crossing's far boundary (c.at + dir*ZEBRA_LENGTH/2), not the near edge
- Task 2: each rule builds its own Graph; rule name parsed from id
- Task 3: useFresh exported needlessly; index shape cast not validated; route label derived from id; unknown debug routeId falls back to random
- Task 4: polyLength duplicate; free spots not deduped across same-kerb directions; CLI double call/trailing colon; 4.2.x note; test gaps for 3.2/3.3/3.11/3.12/3.14/3.15/3.17.x/4.3/4.1.5-6
- Task 5: polyLength 4th copy; dangling node edge id gives bare TypeError; boundary/clipping test gaps
- Task 6: cov-4.3 at 50 m from the ring is outside the 40 m conflict reach; 3.25 guard only same-edge; cov-3.25 ends a 40 zone that does not exist; 5.42 on a residential approach; route-6 drives the Chimkent living street several times; routes 4/6 leave the ring west to avoid the Srkver corner (unusual line); careful-driver tests depend on the traffic seed; giveWaySigns counts advance 2.4

## Open items

- Task 6: underlying examiner/direction issue, turnBetween class can flip with the driven lane near the 30° threshold, and double turns across micro-edges get prompts too late; routes now avoid these, the mechanism is unchanged (M5c or later)

## For M5c

- The examiner reading the new signs, including the right-turn-on-red exception for 5.42.
- AI traffic obeying the new signs.
- Sign names shown in free driving.
- A "signs you have not met yet" debrief.
- Direction signs with real destination names.
