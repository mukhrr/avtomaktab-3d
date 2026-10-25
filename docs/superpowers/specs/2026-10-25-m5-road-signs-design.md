# Avtomaktab 3D, M5: road signs

Status: draft for Mukher's approval, 2026-10-25.

## Intent

Mukher wants a learner to train for real driving in Tashkent, not just pass a game exam. Every road sign in Uzbekistan's Road Traffic Rules should appear somewhere a learner will drive past it. Each one should look like the real sign, and the examiner should mark the learner down when they ignore it, the way a real examiner would.

His words: "i want real exam signs to include all signs so that user can train real life drive in this game". Asked whether signs should only stand where real Tashkent would plausibly have them, or whether every sign should appear somewhere, he chose **full coverage**. Asked how rare signs (railway crossing, narrowing road) should be met, he said **extend the routes where necessary**.

## What exists today

- 41 hand-placed signs of 10 kinds in `data/districts/tashkent-center/signs.json`: stop, give way, priority road, no entry, no left/right turn, no U-turn, speed limit, pedestrian crossing, school. They are validated in `tools/city/build.ts` and drawn from a canvas atlas on poles in `src/world/signs.ts`, one plate per pole.
- `src/sim/signs.ts` answers "which signs are ahead", "which signs govern this junction" and "what is the speed limit here". AI traffic obeys stop, give way and turn bans through it.
- The examiner (`src/exam/rules/`) already checks stop signs, no entry, turn restrictions, wrong way on one-way streets, speeding (from the last speed sign, a school zone, or the road's OSM limit), and yielding at give way and priority junctions. Each penalty in `data/exam/penalties.json` cites a clause of the Rules on lex.uz.
- One exam route, `route-1`, in a district about 1.7 km by 1.5 km.
- The HUD speaks Uzbek and Russian. Free driving outside the exam already exists.

## The source of truth

Uzbekistan's Road Traffic Rules, Cabinet of Ministers resolution 172 of 12.04.2022, including the amendment of 01.04.2026: https://lex.uz/uz/docs/-5953883. Appendix 1 ("Yo'l belgilari") lists the signs. A research pass on 2026-10-25 extracted it to `.superpowers/sign-catalogue.json` with a summary in `.superpowers/sign-catalogue.md`.

| Group | Name | Entries |
|---|---|---|
| 1 | Warning | 50 |
| 2 | Priority | 9 |
| 3 | Prohibitory | 39 |
| 4 | Mandatory | 24 |
| 5 | Information and direction | 84 |
| 6 | Service | 30 |
| 7 | Plates under signs | 61 |
| | Total | 297 |

Facts from that pass that the build must respect:

- Uzbek numbering differs from Russia's GOST R 52290 after group 3. Service signs are 6.x and plates are 7.x. Several warning signs carry different numbers from GOST. The game uses the Uzbek numbers everywhere.
- The official text is Uzbek only. Uzbek names are official. Russian names in the catalogue are translations and are marked as such in the data.
- The text gives no pictures. Shapes, colours and values printed on signs come from convention and must be checked against real Uzbek signs before they ship (see Open guesses).
- Settlement speed limits, clause 78: 60 km/h in Tashkent, 30 km/h within 300 m of a signed school, 20 km/h in residential zones.
- Zone of action, Appendix 1 prohibitory section: signs 3.16, 3.20, 3.22, 3.24 and 3.26 to 3.30 hold until the nearest intersection after the sign, unless a plate 7.2.1, an end sign (3.21, 3.23, 3.25) or a new 3.24 says otherwise. Signs 3.10 and 3.27 to 3.30 apply only to the side of the road where they stand. Recommended speed 5.18 also ends at the nearest intersection.
- Warning signs stand 50 to 100 m before the hazard in a settlement.

## Goals

1. **Every sign and plate exists in the game.** All 297 catalogue entries are data, with number, group, official Uzbek name, Russian name, shape, and for value signs the value printed on them.
2. **They look real.** Correct shape, colours, border, pictogram and lettering for Uzbekistan, sharp enough to read at the distance a driver reads them (about 40 m at city speed). Real mounting: signs share poles, plates hang under the sign they qualify, two signs stack on one pole where the rules put them together, backs are grey metal.
3. **They stand where the rules put them.** Signs that real streets would have are placed by rule from the map data, as far as the data allows:
   - speed limit signs where a road's limit changes, and the 20 and 30 km/h zones
   - no entry at the far end of one-way streets, one-way signs at their start
   - priority road, give way and stop at unsignalled junctions, from the road hierarchy
   - pedestrian crossing at every zebra, and a crossing-ahead warning where the zebra is hidden
   - children warning near schools, parking and service signs at mapped car parks, fuel stations and hospitals
   - direction and street-name signs before major junctions, with real destination names in Latin-script Uzbek
4. **Every sign is met on a route.** Signs no real Tashkent street would naturally carry get a deliberate, plausible place on a route street: a narrowing on a road under repair, a level crossing warning on the tram-free spur, a truck-only ban at a service road. These are marked `coverage` in the data, so it stays clear which placements are invented. Exam routes are extended, and new routes are added, until the routes together pass every sign. A build check fails if any catalogue entry is on no route.
5. **The examiner checks every sign a car driver must obey.** Each sign whose duty applies to a passenger car maps to an examiner rule, either an existing one or a new one, with a penalty in `penalties.json` citing its clause. The zone of action follows the rules above. Signs that bind only trucks, buses, carts or pedestrians are shown, and the examiner correctly ignores them for the Gentra, the same as a real examiner.
6. **The learner can learn from them.** In free driving, passing a sign shows its number and name in the chosen language for a few seconds. In the exam there are no hints. After the exam, each sign violation in the debrief shows the sign's picture, its name and the clause.

## Non-goals

- Road markings (Appendix 2) beyond what M4 already draws.
- A theory quiz on signs. The real theory test is a separate computer exam.
- Electronic and variable message signs, traffic police hand signals.
- Surveying the real position of every sign in Tashkent.
- Changing the vehicle to trucks or buses so truck-only signs bind the player.

## Anti-goals

- **Teaching a wrong rule.** A sign meaning, value or zone of action that differs from the Rules is worse than a missing sign. Every examiner rule cites its clause. A sign whose meaning cannot be confirmed is shown but not penalised.
- **Fake-looking streets.** Coverage placements must look like something Tashkent could have. No forests of signs: at most 3 signs per pole, poles at least 15 m apart on one side unless the rules put signs together.
- **Unreadable signs.** A sign the learner cannot read in time cannot be fairly penalised.
- **A slower game.** The budgets below hold.

## Constraints

From the parent spec and M4, unchanged:

- Reference machine is Mukher's Mac (Apple M5, Chrome). High preset: at most 8 ms frame time in the chase view, at most 120 main-pass draw calls, 1.5 million triangles. Low preset: at most half of those.
- Commits in Mukher's name only, no co-author lines. Nothing pushed until he says so.
- Assets must be CC0, CC-BY or public domain and credited in `CREDITS.md`.

New for M5:

- Signs add at most 4 draw calls in total (plates, backs, poles, and one spare), however many signs stand in the city.
- Sign art adds at most 4 MB to the download and at most 48 MB of GPU memory.
- The build check for route coverage runs in `npm test`.

## The how (Claude's calls, open to change)

- **Sign art is drawn from vector files.** Each sign is an SVG drawn to the Uzbek layout, rasterised at build time into compressed texture atlases with mipmaps. Drawing 297 signs by hand in canvas code, as the 10 existing ones are, would be slow and look worse. The source of the SVGs is the one open question for Mukher (see below).
- **One instanced mesh per part.** Plates, backs and poles are instanced meshes over the atlases, so draw calls stay flat no matter how many signs stand.
- **Sign data grows a little.** `Sign` gains the catalogue number in place of the 10-value `type`, an optional `value`, `plates` (catalogue numbers of plates under it), `side` (which side of the road) and `origin` (`rule`, `hand` or `coverage`). The existing 41 signs are migrated, not replaced. Hand-placed signs win over rule-derived ones at the same spot.
- **Placement runs in the city pipeline.** Rule-derived signs are produced in `tools/city` from the OSM data, alongside crossings and furniture, so they ship in `district.json` and need no work at load time.
- **Several exam routes.** Route-1 stays. New routes are added so that together they pass every sign, each between 4 and 8 km, about the length of a real exam drive. The start screen gets a route choice. The district may grow beyond today's bounding box if the routes need more streets, as long as load time stays under 3 s on the Mac.
- **Zone of action lives in `src/sim/signs.ts`.** One query answers "what prohibitions and mandatory directions apply to this lane at this point". Both the examiner and the AI traffic use it, so traffic obeys the same signs the learner is judged on.

## Open question for Mukher

Where the sign art comes from:

- **Wikimedia Commons, then draw the rest.** Commons has public-domain SVG sets of the Russian and other CIS road signs, the same family as Uzbekistan's. They are renumbered to Uzbek numbers and corrected where Uzbek signs differ. Uzbek-only signs and anything missing are drawn to match. This is the faster path, and the signs look like the real ones from the start.
- **Draw all 297 ourselves.** Nothing is downloaded, and every sign is drawn to the Uzbek layout. This is slower, and getting pictograms right by eye is harder.

## Order

1. **M5a, the sign set.** Catalogue data, sign art for all 297 entries, the new mounting with shared poles and plates, migration of the 41 existing signs, budgets measured.
2. **M5b, placement and routes.** Rule-derived placement, coverage placements, new and extended routes, route choice on the start screen, and the coverage build check.
3. **M5c, the examiner and learning aids.** Zone of action, new examiner rules and penalties with clauses, AI traffic obeying the same signs, sign names in free driving, sign pictures in the debrief.

Each part is planned and built on its own and stops for Mukher's approval before the next one.

## Settled after the builder check (Claude's calls)

- **Checking the art.** Each sign is checked against a photo or an official-style drawing of the real Uzbek or CIS sign, found by the builder (Wikimedia Commons, Mapillary street photos, Uzbek driving-school material). Each catalogue entry records its reference and a `checked` flag. An unchecked sign may ship, but it is never penalised. At the end of M5a Mukher gets a contact sheet of all 297 signs to look over, as part of approving M5a.
- **What counts as confirmed for a penalty.** A sign is penalised only when the Rules' own text, in Appendix 1 or the main clauses, states the driver's duty. The rule cites that clause in `penalties.json`. The catalogue's `carRelevant` and `checkable` fields are a starting point, re-checked against the text for every rule. Mukher sees the full list of new penalties when approving M5c.
- **Variants the text does not name.** Entries like 7.4.2, 7.4.4 to 7.4.8, 7.6.x, 7.5.5 to 7.5.7 and some 5.17.x and 5.19.x count for full coverage when a reference image for them is found. Any variant without one goes on an explicit exemption list in the data. The coverage check reads that list, and the M5a report names every entry on it.
- **Route count and district size.** At most 6 exam routes. The district may grow in any direction the routes need, as long as load stays under 3 s on the Mac and the M4 frame budgets hold.
- **Route choice.** In the exam the route is drawn at random, like a real exam where the examiner picks it. In free driving any route can be chosen and its directions followed without scoring. Full coverage means all routes together, and the debrief tells the learner which signs they have not met yet across their past drives.

## Left to the builder

- Atlas cell size per sign, compression format, and how text-heavy direction signs are drawn, within the budgets.
- The exact road-hierarchy rule for priority and give way at unsignalled junctions, as long as it matches the existing 12 give way and 4 priority signs.
- Which streets each new route uses.
- Penalty tier for each new rule, following the existing table: fail for what endangers others, high for a clear breach, low for a minor one.

## Open guesses (to check against real Uzbek signs while building)

- Pictograms and colours of the Uzbek-only signs: 1.33 box junction, 1.34, 1.35, 3.34, 3.35 eco zone, 5.41, 5.42 right turn on red, 5.43, 5.46, 5.47.x, 5.48 raised crossing, 6.16 to 6.28.
- Whether Uzbek direction signs in Tashkent use Latin-script Uzbek only, or Uzbek and English.
- Real sign sizes in Tashkent streets. The existing plate is 0.65 m, a guess.
