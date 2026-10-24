# Exam route 1, central Tashkent

Waypoints: `data/districts/tashkent-center/routes/route-1.waypoints.json`.
Generated route: `public/districts/tashkent-center/routes/route-1.json` (rebuild with `npm run exam:route -- tashkent-center route-1`).

3.80 km, 49 lane steps, about 9 minutes at 25 km/h average.

## The drive

1. Start at the right curb of Nuroniylar ko'chasi (quiet two-way residential street) at (-409, 49), facing north.
2. At its end turn right onto one-way Matbuotchilar ko'chasi and follow it east onto the ring road around Amir Temur square.
3. Leave the ring north on Amir Temur shoh ko'chasi. At the signalled junction at (83, -439) turn right onto Istiqlol ko'chasi from a multi-lane approach.
4. Follow Istiqlol east. Between (247, -361) and (370, -220) it is signed 50 km/h, the rest of the route is 60.
5. At the end of Istiqlol turn right onto Mustaqillik shoh ko'chasi and drive back to the ring.
6. Leave the ring north on Amir Temur shoh ko'chasi again. This time turn left at the same signalled junction (83, -439) onto Istiqlol ko'chasi heading west.
7. Go straight over the unsignalled junction with Zarafshan ko'chasi at (-319, -556), traffic arriving from the right has priority. Then turn left onto Buyuk Turon ko'chasi at (-587, -640), again with a road arriving from the right.
8. Turn left at the signalled junction at (-768, -144) onto Matbuotchilar ko'chasi, go straight through the signals at (-487, -44).
9. Finish at the right curb of Matbuotchilar ko'chasi at (-440, -25).

## Features

| Feature | Count | Where |
|---|---|---|
| Signalled left | 2 | (83, -439), (-768, -144) |
| Signalled right | 1 | (83, -439) |
| Signalled straight | 1 | (-487, -44) |
| Unsignalled, priority to the right | 2 | (-319, -556), (-587, -640) |
| Zebras | 8 | along the route (two sit just off junction nodes; the district build moves such crossings out of the junction) |
| Signalled pedestrian crossings | 5 | along the route |
| Turns from a multi-lane approach | 2 | both turns at (83, -439) |
| Speed zone changes | 2 | into and out of the 50 km/h part of Istiqlol |
| Stop signs, give-way signs | 1, 2 | stop at (370, -220), give way at (-392, -9) and where Mustaqillik merges at (114, -107) |

## Notes

- The route passes the junction at (83, -439) twice, once turning right and once turning left. It was kept because it covers every feature in 3.8 km; the other candidates from a waypoint search that covered them all were 5.2 to 5.5 km with 7 to 11 turns.
- Speed zones only come from OSM `maxspeed` tags. Untagged roads default to 60 (20 on service roads and living streets), so the 50 km/h stretch of Istiqlol is the one tagged change near the route.
- Priority to the right is only counted where the road arriving from the right is of the same OSM class as the road being driven and is not a yard exit. The right turn from Istiqlol onto Mustaqillik (370, -220) is unsignalled but onto a major road, so it carries a stop sign rather than counting as a priority-to-the-right junction.
- `multiLaneTurns` counts turns from an approach with two or more lanes in that direction. The planner keeps the car in lane 0, so the rule engine decides whether the lane used was the right one.

## Signs

`data/districts/tashkent-center/signs.json`, merged into `district.json` by `npm run city:build` (rebuild the route afterwards, its sign counts come from it). 41 signs, all hand-placed from the route and junction data, not from OSM:

- Give way (12) and stop (4) on side and yard arms joining the route roads, stop on the arms of the two four-way junctions on Istiqlol and Buyuk Turon, and on the Istiqlol stem of the T at (370, -220) so the route passes a stop sign. Priority road (4) on the main approach of the merges that have a give-way arm.
- Speed limit 50 after (247, -361) and 60 after (370, -220), the two zone changes the route counts. School zone (30 km/h for 150 m) at the start of the Istiqlol stretch east of Amir Temur.
- No left turn on Istiqlol at (66, -442), no U-turn on Amir Temur before (83, -439). OSM has no turn restrictions here, so these two are invented for the exam.
- Pedestrian crossing, one per direction, 3 to 5 m before each of the zebras along the route (16 signs).
