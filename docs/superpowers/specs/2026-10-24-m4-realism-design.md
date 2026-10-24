# Avtomaktab 3D, M4: realism

Date: 2026-10-24
Status: draft, waiting for approval
Parent spec: `docs/superpowers/specs/2026-10-23-avtomaktab-3d-design.md`

## Intent

M1 to M3 made the game work: a real district, a car, traffic and an examiner. It still looks and feels like a prototype: plain coloured boxes for buildings and cars, flat light, and no sound except the examiner. M4 is about making a Tashkent driver say "that's my street" in the first minute, and making the car feel like a car.

Mukher asked for all four areas: city looks, light, traffic and car feel (2026-10-24).

## What exists today

- Buildings: OSM footprints extruded to height, six flat colours, no windows or roofs.
- Streets: road surfaces, markings, sidewalks and kerbs from the M1 pipeline; trees along avenues; flat-colour ground.
- Light: one sun with a 2048 shadow map that follows the camera, a hemisphere light, a flat blue background and fog.
- Traffic: five car classes (spark, nexia, cobalt, damas, bus) that differ only in box size; three instanced meshes for all cars. AI cars never change lanes.
- Pedestrians: capsule plus sphere.
- Player car: a few boxes and cylinders. No cockpit model. No engine, tyre or indicator sound.
- Download today: about 3.5 MB.

## Goals

1. **City looks.**
   - Facades with windows, balconies and ground-floor shops. Soviet-era apartment blocks (9 and 16 storey panel blocks) look like themselves, because they are most of central Tashkent.
   - Roofs with some variety: flat roofs with parapets and roof boxes, and pitched roofs on low houses.
   - Street detail: worn asphalt, kerbs, aryk ditches beside avenues, Uzbek road signs as 3D models on poles, street lamps, bus stops.
   - Landmarks, as simple hand-made models: Amir Temur monument and square, Hotel Uzbekistan, the Chimes (Kuranty) clock tower.
2. **Light.**
   - A sky, real shadows tuned for the chase and cockpit views, and tone mapping.
   - Three times of day to pick on the start screen: morning, noon, evening.
3. **Traffic.**
   - Each car class gets its own low-poly model: Cobalt, Nexia, Lacetti, Spark, Damas, yellow taxi, city bus.
   - Paint colours are mostly white, silver and black, as in real Tashkent traffic.
   - AI cars change lanes when a lane is blocked or they need to turn, and they signal before they do. Short horn sounds play when you block a car on a green light.
   - Pedestrians get a simple walking body instead of a capsule.
4. **Car feel.**
   - Engine sound that follows rpm and load, tyre squeal on slip, indicator click, horn, belt chime, and a stall sound.
   - A cockpit: dashboard with working speedometer, rev counter and indicator lamps, steering wheel that turns, A-pillars and mirrors in the right place.
   - The visual body leans when braking, accelerating and cornering.

## Non-goals

- Photoreal graphics. The parent spec prefers clean stylised visuals over a failed attempt at realism.
- Weather (rain, snow), night driving with headlights, and seasons.
- New districts or routes.
- Changes to the rules or scoring. Realism work must not change what the examiner judges.
- Deploying the site. That stays in a later milestone.

## Anti-goals

- It gets prettier but slower than 60 fps on an ordinary laptop.
- Generic "European city" assets that make Tashkent look like somewhere else.
- Sound that gets annoying within five minutes, like a drone engine tone or constant horns.
- Visual changes that move anything the rules read. The rules use road geometry and car positions, so visual models must stay inside the physics and traffic boxes.

## Constraints (from the parent spec, unchanged)

- Free assets only (CC0 or CC-BY), each recorded in `CREDITS.md`.
- 60 fps on a mid-range laptop with integrated graphics at 1080p, with a lower-quality preset as fallback.
- First playable load under 30 MB.
- Desktop Chrome and Edge first.

## The how (Claude's calls, open to change)

- **Mostly procedural, few downloads.**
  - Facades, windows, signs and dashboard gauges are drawn in code (canvas textures and shaders), so they cost almost nothing to download and need no licence.
  - Ground materials (asphalt, concrete, plaster) come from Poly Haven or ambientCG (CC0) at 1k resolution, about 1 MB each.
- **Cars are built in code** from shaped, bevelled profiles, not downloaded. Free models of the Nexia, Damas or Cobalt almost certainly do not exist with a commercial licence. Each class has one shared geometry, drawn with instancing so draw calls stay low.
- **Building style comes from OSM tags and size.** `building=apartments` with 9 or more levels, or tall rectangular footprints, gets the panel-block look. Low buildings get older brick or plaster. Large non-residential buildings get a public-building look. The district override file can name the style per building where the guess is wrong.
- **Light:** three.js `Sky` with sun position per time of day, ACES tone mapping, and two shadow layers (a sharp one near the car and a cheap one further out). The low preset keeps one layer.
- **Sound:** Web Audio, synthesised from rpm and throttle with a few short CC0 samples (tyre, click, horn) from Freesound where synthesis sounds poor.
- **AI lane changes:** a standard model (MOBIL) on top of the existing IDM, using the lane network that already exists. Lane changes are blocked inside junctions and near stop lines, same as the player's rules.
- **Quality presets:** low, medium and high, picked automatically from a short frame-time test on first load and changeable in the menu.

## Order

M4 splits into five parts. Each one ends in something playable, gets its own plan, and is merged before the next starts:

1. **M4a, light and materials.** Sky, time of day, tone mapping, shadows, ground and asphalt materials, quality presets. This comes first because it makes everything after it look better, and it sets the performance budget the other parts must fit.
2. **M4b, buildings and streets.** Facades, building styles, roofs, aryks, lamps, bus stops, 3D signs.
3. **M4c, landmarks.** Amir Temur square, Hotel Uzbekistan, Kuranty.
4. **M4d, traffic.** Car models, paint colours, taxi and bus liveries, pedestrian bodies, AI lane changes, horns.
5. **M4e, car feel.** Sounds, cockpit and dashboard, body lean.

## Settled after the builder check (Claude's calls)

- **Reference machine (Mukher's choice, 2026-10-24):** his Mac (Apple M5, Chrome). Because it is much faster than an integrated-graphics laptop, M4 also keeps proxy budgets that stand in for the slower machine: on the high preset at most 8 ms of frame time on the Mac in the chase view, at most 120 draw calls and 1.5 million triangles in the main pass; the low preset at most half of those.

- **Where it runs:** building styles are picked in the city pipeline and written into `district.json` as one style id per building, so the override file can correct them. Meshes and canvas textures are generated at load time, as today. Generation must stay under 2 s on the reference machine and show the loading screen meanwhile.
- **Download budget for M4 assets:** 10 MB in total (textures, sound samples, landmark models), so the whole game stays well under the 30 MB cap.
- **Sound:** short CC0 engine loops crossfaded by rpm and throttle are allowed from the start, with synthesis only for small effects. A droning synthesised engine is the failure to avoid.
- **AI lane changes and the exam:** lane changes draw from their own seeded random stream. The headless exam runs from M3 must still pass after M4d (careful driver 0 to 10 points, red-light runner fails, one noIndicator per maneuver). If AI behaviour changes a seed's outcome, the test driver is fixed, not the rules.
- **Player car size:** the physics box and the rule geometry stay as they are. The new body and cockpit fit inside them.
- **Done means:** each part has a short yes/no checklist in its plan, plus screenshots compared side by side with Street View or Yandex panoramas of the same spots. Mukher has the final say on looks.
- **Taxi and bus looks** stay as the guesses below until checked against panoramas. The quality preset is picked once on first load and saved, with the menu able to change it.

## Left to the builder

- Exact colours, textures and the look of each facade style.
- How many window and shop variants there are.
- Sound mixing and volumes.
- The exact quality preset thresholds.

## Open guesses (to check against Street View or Yandex panoramas while building)

- Tashkent taxis: the guess is yellow or white cars with a roof sign. Check the current look before modelling.
- Tashkent city buses: the guess is the common Isuzu and MAN models in blue or green. Check before modelling.
- Where in the district the panel blocks are, compared with older low-rise streets.
