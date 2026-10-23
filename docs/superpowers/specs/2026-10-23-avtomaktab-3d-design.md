# Avtomaktab 3D: design

Date: 2026-10-23
Status: draft, waiting for approval

## Intent

A browser driving game set on the real streets of Uzbekistan's cities. It teaches you to drive by Uzbek road rules, with an examiner in the passenger seat who scores you.

Why it should exist: the apps out there today cover theory tests and the closed exam course (avtodrom), mostly on phones. None of them is a polished web game where you drive real Uzbek city streets under Uzbek rules. That gap is the product.

The first impression we want: someone from Tashkent opens it in a browser, drives a few blocks and says "that's my street".

## Users

- People preparing for the category B license who want practice in real traffic situations.
- New drivers who are nervous about real city traffic.
- Later: driving schools (avtomaktab) using it in class.

## Goals for v1

1. **One district, done properly.** Central Tashkent around Amir Temur square, about 2 × 1.5 km, built from OpenStreetMap data, with believable road surfaces, lane markings, sidewalks, buildings and avenue trees.
2. **A car that feels real.** A Chevrolet Cobalt style sedan (the common exam car) with real vehicle physics, automatic and manual gearbox (clutch, stalling), a cockpit view with working mirrors, and a chase camera.
3. **Living streets.** AI traffic that follows lanes, stops at red lights, yields and keeps distance. Pedestrians who cross at zebras. Traffic lights on real signal positions.
4. **Examiner drive.** A set route through the district. The examiner gives turn-by-turn voice directions in Uzbek and Russian. Mistakes are detected and scored, and you fail at 100 penalty points. At the end there's a debrief: total points, a list of mistakes, and their locations on a map.
5. **Free drive** with no scoring.
6. **Languages:** Uzbek (Latin) and Russian for all UI and voice.

## Non-goals for v1

- Theory test and avtodrom exercises. Other apps already cover them, and they may come later.
- Cities other than Tashkent. The pipeline is built to make adding them cheap, but v1 ships one district.
- Phones and touch controls. Desktop browsers come first.
- Accounts, saved progress across devices, payments, multiplayer.
- Claiming it's an official exam replica. See "Exam realism" below.

## Anti-goals (failure even if it technically works)

- It feels like a generic city with Uzbek labels pasted on. Real street layout and local detail matter more than graphics fidelity.
- Wrong rules. If the examiner punishes something that's legal in Uzbekistan, or misses something that's illegal, trust is gone.
- Slow to load or choppy on an ordinary laptop.

## Constraints

- **Platform:** desktop Chrome and Edge are the main targets. Firefox and Safari should work but aren't tuned.
- **Performance target:** 60 fps on a mid-range laptop with integrated graphics at 1080p, with a lower quality preset as fallback. First playable load under 30 MB.
- **Input:** keyboard required. Gamepad and steering wheel through the browser Gamepad API.
- **Map data:** OpenStreetMap under ODbL. The game must show "© OpenStreetMap contributors" attribution.
- **Assets:** only models, textures and sounds whose licences allow commercial use. Every third-party asset is recorded with its licence.
- **Traffic side:** right-hand traffic, Uzbek road rules (YHQ) and Uzbek road signs.

## Team, budget and review (decided)

- **Team:** the owner and Claude write all code. There's no fixed deadline, so milestones are ordered by value and each one ends in something playable.
- **Art budget: zero.** Only free assets with CC0 or CC-BY licences (e.g. Poly Haven, Kenney, Quaternius, ambientCG, Sketchfab CC-BY), with credits recorded in `CREDITS.md`. What can't be found free gets modelled simply or generated procedurally (facades, roofs, trees). Clean, stylised visuals are preferred over a failed attempt at realism.
- **Rule review:** rules are built from the YHQ text and web sources, with the clause cited in each rule entry. A driving instructor reviews the rule set and the exam route before public launch. Until then, the game labels scoring as "practice scoring".
- **Street ground truth:** checked against Street View or Yandex panoramas while authoring the district override file.

## Exam realism

Research done on 2026-10-23 found:

- The practical exam is passed with 99 penalty points or fewer (xabar.uz). An older prava.uz page says most errors cost 20 points and creating a dangerous situation costs 100.
- Errors fall into three tiers (osonprava.uz). Instant fail: red light, not yielding to a pedestrian, entering the oncoming lane. High points: no indicator, no mirror check, stopping past the stop line. Low points: stall, wrong gear.
- A May 2024 Interior Ministry draft order describes the practical exam as taking place on the avtodrom only. An official city-driving stage could not be confirmed.

So the examiner drive is framed as **"real-world driving practice scored the way an Uzbek examiner thinks"**, not as an exact copy of the official exam. The penalty table lives in one data file, so it can be corrected without code changes once an official sheet is found.

## Decided

- **Name:** Avtomaktab 3D.
- **Web first.**
- **Scope:** all of Uzbekistan over time, starting with the Tashkent center.
- **Focus:** real city driving, not theory or avtodrom.
- **Exam routes:** exact official routes don't matter. We design our own routes through real streets.

## The how (builder's call unless noted)

### Tech stack (Claude's call, accepted in conversation)

- TypeScript, Vite.
- Three.js for rendering. Plain Three.js for the 3D world, with a small React layer only for menus, HUD and the debrief.
- Rapier (WASM) for vehicle physics, using its raycast vehicle controller, with a custom drivetrain (engine torque curve, clutch, gearbox, stall) on top.
- Static hosting (Vercel or Cloudflare Pages). No backend in v1.

### City pipeline

An offline build step turns OSM data into game data:

1. Download one bounding box from OpenStreetMap. The Overpass API was overloaded during the test, and the main OSM API `map` call worked.
2. Convert to local metres around a fixed origin. Extract roads (type, width, lanes, oneway, name), buildings (footprint, height or levels), green areas, water, traffic signals, crossings and stop lines where tagged.
3. Build a **road graph** (nodes = junctions, edges = lanes with direction) used by AI traffic, the examiner route and rule checks.
4. Generate meshes. Roads need proper junction surfaces, not overlapping ribbons. Add curbs and sidewalks, markings by road type, buildings with facade textures, roofs and some variety, trees along avenues and in parks.
5. Output compressed glTF plus a JSON road graph per district.

OSM in central Tashkent has some messy data (stacked parallel ways, untagged heights). The pipeline needs a small manual override file per district to fix lanes, heights and landmarks.

### Local feel

- Cars: Cobalt, Nexia, Lacetti, Spark, Damas, yellow taxis, buses.
- Wide avenues lined with plane trees, aryk ditches beside roads, Uzbek signs and markings, a few recognisable landmarks in the district (Amir Temur monument, Hotel Uzbekistan) as hand-made models.

### Rule engine

Rule checks run against the road graph and the car's state each tick. Minimum v1 set:

- Red light running, stop line overrun
- Speeding by zone (60 city default, 30 near schools where tagged, or from `maxspeed`)
- Indicator not used before a turn or lane change
- Mirror check not done before a turn or lane change (checked from the camera or head direction in cockpit view)
- Failure to yield to pedestrians on a crossing
- Wrong-way driving and crossing a solid line
- Collision with a car, pedestrian or object
- Stall, harsh braking, rolling back

Each check maps to an entry in the penalty table (tier, points, Uzbek and Russian text).

### Examiner

- Route = a sequence of road graph edges. Directions are triggered by distance to the next manoeuvre.
- Voice lines are pre-recorded or generated TTS clips in Uzbek and Russian, triggered by events.
- When there's an instant fail, the examiner stops the drive and the debrief opens.

### Debrief

Total points and pass or fail, a list of mistakes with timestamps, and a top-down map of the route with each mistake marked.

## Calls made after review (Claude's, open to change)

- **Rule baseline:** the penalty table starts from the avtodrom-simulator table (MIT) plus the three tiers above, and is extended for city rules. Every rule entry cites the YHQ clause it comes from.
- **Rule set:** the minimum set above is extended with: yielding at unsignalled junctions (right-hand priority), give-way/stop/no-entry/turn-restriction signs, and lane choice before a turn. OSM rarely tags signs in Tashkent, so signs and priorities are hand-placed in the district override file, covering at least every junction on the exam route.
- **Mirror checks:** held glance keys (left mirror, right mirror, rear-view) work in every camera. In cockpit view, looking toward a mirror with the mouse also counts. The exam can be driven in any camera.
- **Routes:** v1 ships one hand-built exam route of about 8 to 12 minutes that triggers every rule in the set at least once. A route tool waits until there are more routes.
- **Voice:** generated TTS (for example edge-tts, as avtodrom-simulator does) from a fixed script of direction and feedback lines in both languages. Directions use generic phrases ("at the next junction turn right"), not street names, so recorded voice can replace TTS later without changing code.

## Left to the builder

- Exact visual style, textures and lighting.
- How AI traffic is implemented (path following on the road graph is fine, they don't need full physics).
- Audio design.
- Which district boundaries exactly, as long as Amir Temur square and several major avenues are included.
- Quality presets and LOD strategy to hit the performance target.

## Prior art

- `axadjonovsardorbek/avtodrom-simulator` (MIT, Three.js): web avtodrom for Uzbekistan, with an official-style penalty table. Useful reference for scoring and Uzbek voice generation.
- "Автодром ПДД Узбекистан" (mobile, paid): avtodrom routes for 8 cities.
- City Car Driving (PC): the quality bar for city traffic, but no Uzbek rules.
- Roadarium (Three.js): proves OSM-generated cities drive well in a browser.

## Evidence from the test (2026-10-23)

A throwaway test (`spike/`) loaded 1,297 roads, 424 buildings, about 4,300 trees and 82 traffic lights from OSM into a drivable Three.js scene. The data was 318 KB. It felt promising to the user. FPS was not measured.
