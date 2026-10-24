# Exam: rules, examiner and tuning

Practice scoring only. Clauses are from the Road Traffic Rules (YHQ), decree No. 172 of 12.04.2022, see `penalty-sources.md` for quotes and the reading date. Points and tiers live in `data/exam/penalties.json`, every tunable number in `src/exam/rules/thresholds.ts`.

## Tiers

- fail: 100 points, the exam ends at once.
- high: 20 points.
- low: 5 points.

The exam is also failed when the total reaches 100.

## Rules

| id | tier | points | clause | what is charged |
|---|---|---|---|---|
| redLight | fail | 100 | 31 | The front goes 2 m past the stop line while the light is red or red-yellow, and it was red when the front crossed the line. A light that turns red after the car stopped past the line on green is not charged. |
| yellowEntry | high | 20 | 31, 42 | The front crosses the line on yellow although the car could have stopped at 4 m/s² when the yellow came on. |
| stopLinePast | high | 20 | 41 | The car comes to a stop on red with its front between 0.5 m and 2 m past the line. Held 3 s so a following redLight on the same line replaces it. |
| noFullStopAtStopSign | high | 20 | 1-ilova, 2.5 | The front passes the end of a stop-sign approach without a stop (below 0.3 m/s) within the last 10 m. |
| pedestrianNotYielded | fail | 100 | 109 | The front enters a zebra or signal crossing band while someone is on the carriageway there, or at a zebra while someone waits at the kerb, if the car was outside its stopping distance when they appeared. A stop of 1 s short of a zebra releases the kerb duty. |
| vehicleNotYielded | fail | 100 | 104 | Unsignalled junction: entering while a moving car within 3 s of the junction has a higher-ranked approach, or an equal one from the right. On green: turning left across a moving oncoming car that goes straight, within 3 s. Cars already on their connector do not count. |
| oncomingLane | fail | 100 | 64 | The car centre stays 0.9 m over the centre line of a two-way road for 1 s, outside junctions. |
| wrongWayOneway | fail | 100 | 1-ilova, 5.5 | Driving forward against a one-way road for more than 1.5 s. |
| noEntry | fail | 100 | 1-ilova, 3.1 | Staying 0.5 s on a road whose start carries a no-entry sign within 40 m. |
| turnRestriction | high | 20 | 1-ilova, 3.18.1, 3.18.2 | A turn that a no-left, no-right or no-U-turn sign at the junction forbids. |
| collisionCar | fail | 100 | unverified | Contact with an AI car while the player moves at 1 m/s or more. One crash counts once (3 s). |
| collisionPedestrian | fail | 100 | unverified | Hitting a pedestrian. |
| collisionObstacle | fail | 100 | unverified | Hitting a building or other obstacle above 2 m/s. |
| speeding | low | 5 | 78 | More than 5 km/h over the limit, once per 5 s over. |
| speedingSevere | fail | 100 | 78 | More than 40 km/h over at any moment, or more than 20 km/h over for 3 s. The thresholds are the game's choice. |
| noIndicator | high | 20 | 45 | A turn or lane change without the matching indicator on for 1 s before it started. Straight on through a junction needs none. |
| noMirrorCheck | high | 20 | 47 | A turn or lane change without a glance at that side's mirror in the 6 s before it. |
| wrongLaneForTurn | high | 20 | 56 | On a road with two or more lanes, a right turn not from the rightmost lane or a left turn not from the leftmost. |
| tailgating | low | 5 | 73 | Above 20 km/h with less than 1 s to the car ahead for 3 s; again after 10 s. |
| harshBraking | low | 5 | unverified | Braking harder than 6 m/s² for 0.3 s with no reason in sight (light, pedestrian, close car, car pulling out, crash). |
| stall | low | 5 | unverified | The engine stalls on a manual car. |
| rollBack | low | 5 | unverified | Rolling back more than 0.5 m in a forward gear. |
| noSeatBelt | low | 5 | 9 | Driving above 5 km/h without the belt, once per exam. |
| stoppedOnCrossing | high | 20 | 112 | Standing still for 2 s with the car over a zebra or signal crossing band. |
| noIndicatorPullOff | low | 5 | 45 | Moving off from the kerb at the start without the left indicator. |

Rules that see the same mistake twice charge it once: redLight hides stopLinePast and yellowEntry on that line, noEntry hides wrongWayOneway on that road, and a yielding fail hides the collision that follows within 3 s.

## Examiner flow

1. Start places the car at rest at the route start, belt off, and clears AI cars and pedestrians within 40 m.
2. The brief is spoken on the first step. Rules count from the next step; the drive does not wait for the belt or the voice.
3. Directions come from the route: an early prompt, then a "now" prompt before each junction. The route is followed with a forward-only cursor, since route-1 drives one road twice.
4. If the car holds a lane that is not on the route for 0.5 s, the examiner replans to the remaining waypoints and says so. A failed replan is retried after 5 s.
5. Every violation is announced (high and fail tiers aloud, all as a toast). A fail-tier violation or a total of 100 ends the exam as failed.
6. Stopping within 15 m of the finish, below 0.5 m/s for 2 s, ends it as finished. Leaving the district or pressing R ends it as abandoned.
7. At the end the engine releases held violations up to the end time, and the debrief lists everything in time order on a map.

## Headless runs

`src/exam/examRun.test.ts` drives route-1 with the real M2 traffic and pedestrians (60 cars, 40 crossers, 80 walkers, seeds 1 and 2 as in `main.ts`). The car moves kinematically along its planned lanes (`src/exam/testDriver.ts`); rules, examiner, traffic and pedestrians are the production code. Contact with AI cars and pedestrians is detected from box overlap and reported as the same events the physics sends.

| driver | result |
|---|---|
| careful | finished, 0 points, about 1230 s of sim time (about 4 min of it held in the jam ring near (-230, 50)) |
| runs red lights | failed on redLight, its only violation |
| never indicates | 11 noIndicator over the whole route (6 turns, 5 lane changes on 22813507:0) and 1 noIndicatorPullOff; the exam fails on the fifth noIndicator |

The three runs take about 45 s together. Other seeds with M4d lane changes: 3, 7, 9 and 11 all finish with 0 points (712, 618, 618 and 667 s).

## Tuning log

No threshold was changed. Every false positive the careful driver showed in playtesting was traced to the driver script, not to a rule, and fixed there:

- noIndicator on a "left" while going straight: the driver kept the rightmost lane at a fork, the matcher took the other branch. A driver now picks the lanes that lead to its branch.
- vehicleNotYielded at a pair of junctions joined by a 1 m road: the driver now gives way before the first of the two.
- vehicleNotYielded when a car standing at its line moved off: the driver now waits for such cars, and keeps checking until its centre enters the junction.
- redLight after a stop the driver thought was short of the line: stop lines and crossings are now placed by the matcher's own measure along the road centreline, not along the lane.
- collisionCar with an AI car turning right from a middle lane, and with a car alongside during a lane change: the driver now watches for crossing courses and waits for a gap.
- collisionPedestrian and stoppedOnCrossing with crossers walking off along the kerb line: the driver now gives way to anyone on its path and does not enter a crossing it cannot clear.
- pedestrianNotYielded at a zebra drawn past the lane end, in the junction mouth: the driver now looks for crossings up to 15 m past the lane end.

Fix round 1 changed M2 code, not exam thresholds: AI cars turn right only from the rightmost lane and left only from the leftmost, a stuck car is cleared after 60 s when behind the player, after 120 s when in sight and after 240 s when within 15 m in front, never while touching the player, an AI car no longer waits for a standing player whose box it would not touch, and crossers leaving a crossing walk off the carriageway instead of along the kerb line. The driver workarounds for walking-off crossers were removed.

Fix round 2: the district build moves marked crossings that OSM puts on or inside a junction back onto their approach (20 of 161 moved), so a car waiting at the junction no longer stands on one. Route-1 then counts 8 zebras instead of 6; its steps are unchanged.
