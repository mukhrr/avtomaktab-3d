# M5b placement and routes: rulings, counts and deferred work

Collected from the build ledger when M5b finished. Road signs are now placed by rule from the map, six exam routes exist, every one of the 297 catalogue signs is met on at least one route, and free driving can be guided along a route without scoring.

## Rulings

- Preflight: Ruling: the 3.24-below-20 and 4.7-above-40 checks in routeConflicts apply to coverage signs only; for rule signs the whole-district test checks manoeuvre conflicts (3.1, 3.2, 3.18.x, 3.19, 4.1.x, 4.3), rule 3.24 values mirror the mapped limit; cost if wrong: one test filter
- Task 2: Ruling: parking uses 5.15 and hospital 6.2 (the plan's 6.4/6.1 were wrong codes; catalogue wins); cost if wrong: one constant
- Task 2: Ruling: school zone limit is min(30, edge maxspeed) in speedLimitAt, and 1.21 is not placed on service or living_street edges, a school sign must never raise a limit; clause 78 sets 30 as a maximum; cost if wrong: fewer school warnings on yards
- Task 2: Ruling: halves of a divided road (a one-way primary/secondary/tertiary edge with an opposite-direction one-way edge of the same name within 40 m) get no 5.5 and no 3.1, Tashkent marks one-way streets, not each carriageway of a divided road, and 574 one-way signs read as clutter; cost if wrong: fewer one-way signs on boulevards
- Task 2: Ruling: service-road approaches get no 2.4, and a junction whose only lower-ranked approaches are service roads gets no 2.1, leaving a yard or car park already means giving way under the rules, without a sign; cost if wrong: fewer priority signs at driveways; behaviour unchanged (equal rank → existing right-hand rule)
- Task 2: Ruling: accept priority deferring to hand signs within 40 m, wiring after controllers, and noEntry instead of wrongWayOneway for rule 3.1 (both 100-point fails)
- Task 3: Ruling: minimap route line only on guided free drives, never in the exam, a real examiner gives directions, not a map; cost if wrong: one flag
- Task 3: Ruling: unscored drives keep the start brief (belt, mirrors), useful practice; cost if wrong: one line skipped
- Task 4: Ruling: 3.1 conflicts follow the examiner, on any step after the first, a 3.1 within NO_ENTRY_REACH of the edge entry is flagged regardless of the finish position, the tool must never pass what the examiner charges; cost if wrong: over-flagging a few spots
- Task 4: Ruling: 3.35 eco zone is treated as binding the Gentra (its eco class is unmodelled) and flagged on driven lanes; it can still be met as a side-street junction sign; cost if wrong: one sign placed off-route
- Task 5: Ruling: a sign off the route counts for a junction node the route passes when it stands within 40 m of that node on an edge the route does not drive there, and governs traffic ENTERING that edge from the node (dir leads away from the node), any code, that is the face a driver at the junction sees, and it matches the examiner's NoEntryRule; cost if wrong: coverage counts differ
- Task 6: Ruling: routes are re-waypointed around double-turn micro-edges, the Srkver lane-dependent transition, and unprotected median lefts; a careful-driver examRun test per new route (with traffic as main.ts runs it) asserts pass, no noIndicator, no noMirrorCheck, finish under 1500 s, a randomly drawn route must be fair; cost if wrong: some coverage re-placed
- Task 6: Ruling (correction): 5.42 stands on a signalled approach that no route turns right from; routeConflicts flags a right turn at the signals past it; the right-on-red exception is M5c work; cost if wrong: one sign
- Task 6: Ruling: 4.6.x path signs join the lane-ban check regardless of carRelevant; 5.22-5.25 are placed only where they do not change the limit the examiner applies (side edges); 5.19.1 dead end never on a through edge the route continues, signs on routes must not teach breaking a rule; cost if wrong: re-placement
- Final: Ruling: rule placements clip to the lane path's startAt/endAt like freeSpots; signs that do not fit a short edge are dropped and logged; the junction and other-carriageway pole checks cover every origin; cost if wrong: fewer rule signs on very short edges
- Final: Ruling: living_street maxspeed is min(20, mapped) at extract, so 5.38 zones, examiner and AI agree with clause 78; 5.38/5.39 bracket a whole chain of living-street edges, not every block; routes re-timed (reroute if a careful-driver test exceeds 1500 s); cost if wrong: slower routes 4 and 6
- Final: Ruling: speedLimitAt takes the later of a passed 3.24 and 1.21, and a passed 3.25 after the last 3.24 restores the 60 km/h settlement default; cov-3.25 is re-placed to end a real 3.24 stretch, the examiner must honour the end sign it shows; cost if wrong: one small examiner change
- Final (fix wave): a rule pole that lands in a junction area or more than 0.5 m into another carriageway slides away from its junction, up to 10 m (3 m for crossing signs), before it is dropped; a priority sign on an approach shorter than 15 m stands as far back as the lane allows and is dropped only where under 2 m of lane is left; cost if wrong: a few signs a little further from their junction
- Final (fix wave): 4.3 accepts a straight-on merge onto the ring as well as a right turn, since four of the five approaches to the Amir Temur ring join it straight on; a left or U-turn past it is still flagged; cov-4.3 stands 29 m before the ring; cost if wrong: one sign
- Final (fix wave): route-2 is re-routed because its permissive left at the Buyuk Turon / Matbuotchilar signals, across two oncoming lanes, failed the careful driver with traffic once living streets slowed to 20; the route walker now refuses a left across two or more oncoming lanes even at signals; cost if wrong: 21 coverage signs re-placed
- On a guided free drive, "leaving the route" (the drive ends) means R, Esc, a flip or out of bounds; driving off the route only re-plans it, and the minimap line follows the new plan.

## Signs in the district

709 signs stand in the built district.

| Origin | Count | By group |
|---|---|---|
| hand | 41 | 1: 1, 2: 20, 3: 4, 5: 16 |
| rule | 439 | 1: 12, 2: 43, 3: 125, 5: 254, 6: 5 |
| coverage | 229 | 1: 49, 2: 7, 3: 36, 4: 24, 5: 83, 6: 30 |

Rule signs by code: 5.5 ×96, 3.1 ×111, 5.16.2 ×74, 5.16.1 ×23, 5.15 ×41, 2.1 ×25, 2.4 ×18, 3.24 ×14, 1.21 ×12, 5.38 ×10, 5.39 ×10, 6.2 ×5. The final fix wave took the rule count from 595 to 439: 5.38/5.39 now bracket whole living-street chains (102 to 20), and signs whose pole had no room between two junction mouths or clear of another road were dropped with a build log line (74 lines: 26 one-way, 16 no-entry, 16 priority, 10 speed, 6 far-side crossing poles that would stand in the median).

The coverage signs carry 61 plates (group 7). They are listed in `data/districts/tashkent-center/coverage.json`. The build merge places all 229 with 0 moved and 0 dropped, and `signs:spots` shows 0 conflicts with a route. No pole of any origin stands in a junction area or inside another road's carriageway (district test).

## Routes

| Route | Length | Coverage signs met | Careful driver, empty roads | Careful driver, with traffic |
|---|---|---|---|---|
| route-1 | 3.80 km | 11 | pass, 0 pts, 403 s | pass, 0 pts, 803 s |
| route-2 | 6.50 km | 53 | pass, 5 pts (harshBraking), 680 s | pass, 0 pts, 1300 s |
| route-3 | 6.05 km | 59 | pass, 10 pts (2x harshBraking), 708 s | pass, 5 pts (harshBraking), 1018 s |
| route-4 | 5.68 km | 59 | pass, 0 pts, 904 s | pass, 0 pts, 1191 s |
| route-5 | 5.77 km | 60 | pass, 0 pts, 610 s | pass, 0 pts, 1087 s |
| route-6 | 5.77 km | 53 | pass, 0 pts, 808 s | pass, 0 pts, 1157 s |

Traffic is as main.ts sets it up: 60 cars, 40 crossers, 80 walkers, traffic seed 1 (pedestrian seed 2), after a 30 s warm-up. Times are sim seconds from the start of the drive. The numbers come from `runExam` with the scripted careful driver, the same harness as `src/exam/examRun*.test.ts`; route-1's cells come from the same harness and its own `examRun.test.ts` asserts the traffic case.

Route-1 is the M3 exam route and was not changed; its traffic time went from 670 s to 803 s once living streets dropped to 20 km/h, with the same result. Routes 2 to 6 were built by a lane walker that only uses moves a careful driver can follow, then checked with the scripted careful driver. No route has a noIndicator or noMirrorCheck finding. Each of routes 2 to 6 has its own careful-driver test with traffic, under 1500 s.

Route-2 now runs Amir Temur 1-o'tish, Mustaqillik, Shahrisabz, Navoiy, Zarafshan, Istiqlol ko'chasi, Istiqlol, Srkver, Amir Temur, Shahrisabz, Istiqlol, Zarafshan, Navoiy, Amir Temur, Srkver, Mustaqillik and Zarafshan, and finishes on Istiqlol ko'chasi.

The exam draws one route at random. Free driving lets the player pick a route to be guided along (minimap line, no scoring) or none.

## Measured

- Draw calls at the spawn on high: 87, unchanged from M5a (re-measured after the final fix wave, median of 90 frames).
- Atlas: 2048 x 2656, 1.01 MB PNG, within the M5a budget.
- Load time: measured only in headless swiftshader, 15 to 17 s, unchanged. The 3 s target on Mukher's Mac is not measured.
- Frame time on Mukher's Mac is not measured.
- Tests: 105 files, 1084 tests passed after the final fix wave.

## Deferred minors

- Task 1: no fuel/kindergarten fixture coverage; amenity node that is also an amenity-way vertex would give two POIs
- Task 2: each rule builds its own Graph; rule name parsed from id
- Task 3: useFresh exported needlessly; route label derived from id; unknown debug routeId falls back to random
- Task 4: polyLength duplicate; free spots not deduped across same-kerb directions; CLI double call/trailing colon; 4.2.x note; test gaps for 3.2/3.3/3.11/3.12/3.14/3.15/3.17.x/4.1.5-6
- Task 5: polyLength 4th copy; boundary/clipping test gaps
- Task 6: 3.25 guard only same-edge (a 3.24 on one edge and a 3.25 on the next are not linked); 5.42 on a residential approach; route-6 drives the Chimkent living street several times; routes 4/6 leave the ring west to avoid the Srkver corner (unusual line); careful-driver tests depend on the traffic seed; giveWaySigns counts advance 2.4
- Final: eight junctions keep priority signs on some approaches while one approach had no room for its pole (13528828047, 11166411192, 356633495, 358197517, 1935204917, 2181512789, 13525257386, 13528828051); signing none of their approaches is the cleaner rule but moves traffic, so it waits for a decision on realism, not on one seed
- Final: the scripted driver and a kerb-waiting pedestrian can wait for each other for ever (seen at crossing 217, near (270, 349) on Istiqbol, on a trial route); a test-harness issue, not a route one
- Final: a few coverage poles moved to within 1 to 4 m of an edge start (cov-4.9.1 with cov-1.31.3, cov-5.20.5, cov-6.7); they pass the junction and carriageway checks

## Open items

- Task 6: underlying examiner/direction issue, turnBetween class can flip with the driven lane near the 30° threshold, and double turns across micro-edges get prompts too late; routes now avoid these, the mechanism is unchanged (M5c or later)

## For M5c

- The examiner reading the new signs, including the right-turn-on-red exception for 5.42.
- AI traffic obeying the new signs.
- Sign names shown in free driving.
- A "signs you have not met yet" debrief.
- Direction signs with real destination names.
