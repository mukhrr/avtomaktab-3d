# M4e car feel

`m4e/car-feel` dev build, 1280x720, noon, free drive at the spawn.

## Task 3: Gentra body and lean

| Shot | URL params | What |
|---|---|---|
| [gentra-chase.jpg](gentra-chase.jpg) | none | chase view at the spawn, car settled |
| [gentra-side.jpg](gentra-side.jpg) | `?cam=-52.6,1.2,103.6&look=-54.4,109.4` | side profile: rounded nose, sloping rear window, short high boot, 15 inch rims |
| [gentra-front.jpg](gentra-front.jpg) | `?cam=-48.4,1.4,112.2&look=-54.4,109.4` | front: split grille with chrome bar, lower intake, no badge |
| [gentra-braking.jpg](gentra-braking.jpg) | none | full braking from 48 km/h after 0.35 s, `car.lean.pitch` at the 3 degree clamp |

Player car draws in 11 meshes (was 15): paint, fixed parts, lamps, and a tyre and rim per wheel.

## Task 4: cockpit

| Shot | What |
|---|---|
| [cockpit-idle-noon.jpg](cockpit-idle-noon.jpg) | cockpit view at the spawn, tacho at idle, belt lamp lit, mirrors and road clear |
| [cockpit-indicator-noon.jpg](cockpit-indicator-noon.jpg) | left indicator on, green arrow lit on the gauge strip, steering wheel stripe turned to the left |
| [cockpit-60kmh-evening.jpg](cockpit-60kmh-evening.jpg) | 59 km/h in D4, both needles up, belt lamp off, wheel straight |

The cockpit adds four main-pass calls (dashboard, body edges, wheel, gauges). The gauge panel is one canvas redrawn at 15 Hz.

## Task 5: budget check

Numbers are in `docs/perf/README.md`, M4e section. High cockpit gpu p95 7.5 to 7.9 ms (budget 8), 78 calls (budget 120), chase 89 calls (7 fewer than before), audio 0.01 ms per frame mean. Gauge uploads were the one cost that needed fixing.

## Audio

All sound is synthesised in Web Audio, nothing is downloaded. It starts from the Start click and has an on/off and a volume on the start screen.

What it does:

- Engine: three harmonics of the engine speed plus a noise layer, filtered by throttle load, with a slight random wobble so it does not drone.
- Tyre squeal, only while the tyres slide.
- Indicator clicks, one on switching on and one every half blink while it stays on (hazards included).
- Seat belt chime, repeating while the belt is open and the car is above 10 km/h.
- Horn on N, while held.
- Starter sound on start and a cough on stall.
- Fades out on the menu, suspends when the tab is hidden.

What it does not do: no gear shift sounds, no road or wind noise, no collision sounds, no reverse beeper, no exhaust pops, and no change with the surface. The builder has not heard any of it. It is checked only by parameter tests against a stub AudioContext (frequencies, gains, filter values, node counts, events), so the engine tone and the squeal level still need ears.

## Real Gentra model

`main` dev build, 1280x720, noon, high preset, free drive at the spawn. Same URL params as the Task 3 shots.

| Shot | What |
|---|---|
| [gentra-real-side.jpg](gentra-real-side.jpg) | side profile of the glb body, model wheels in the arches |
| [gentra-real-front.jpg](gentra-real-front.jpg) | front, grille bowtie removed |
| [gentra-real-chase.jpg](gentra-real-chase.jpg) | chase view at the spawn |
| [cockpit-real.jpg](cockpit-real.jpg) | cockpit view: the model's interior is on CAR_LAYER and does not show through the dashboard |

Player car draws in 14 meshes (5 body groups, 5 lamp groups, one per wheel), only the paint casts a shadow. Chase view at the spawn, high: 90 main-pass calls with the glb and its lamps, 89 with the old code-built body (86 for the glb before the lamp split). Triangles in the main pass 800k against 753k. The glb is 1.61 MB (1,608,708 bytes).

Mesh to material table the pipeline found in assets-src/gentra/raw (98 meshes, 22,685 triangles):

| Material | Group | Meshes | Triangles | Area m² |
|---|---|---|---|---|
| Material.006 | paint | 20 | 9228 | 14.9 |
| Material___585 | interior | 5 | 1969 | 17.6 |
| Material11 | shell | 6 | 1248 | 16.6 |
| Material___593 | shell | 16 | 1130 | 10.6 |
| Material5 (rims) | wheel | 4 | 4480 | 2.9 |
| Sidewall | wheel | 4 | 1200 | 0.7 |
| Tread | wheel | 4 | 960 | 1.9 |
| Material7 (hub discs) | wheel | 4 | 40 | 0.4 |
| HeadLights | lights | 2 | 594 | 0.6 |
| Material___586 | lights | 6 | 406 | 0.5 |
| chrome | chrome | 4 | 517 | 0.2 |
| Suspension | paint (baked to vertex colour) | 10 | 212 | 1.1 |
| SideLights | paint | 2 | 50 | 0.07 |
| Material4 (windows) | glass | 6 | 160 | 2.9 |
| Material8 (tail lamp lenses) | glass | 2 | 198 | 0.2 |
| Material14 (headlamp lenses) | glass | 2 | 268 | 0.2 |
| Aerials | dropped | 1 | 25 | 0.003 |

Material___585 has the largest area but is the interior atlas; the paint is Material.006, the largest untextured one.

## Car lamps

| Shot | What |
|---|---|
| [lamps-rear-brake-left.jpg](lamps-rear-brake-left.jpg) | evening chase, brake held, left indicator in its lit phase, headlight beams on the road ahead |
| [lamps-reverse.jpg](lamps-reverse.jpg) | evening chase, R selected, reverse cells lit |
| [lamps-front-evening.jpg](lamps-front-evening.jpg) | front at evening, headlights on by themselves, two spot light beams |

Five lamp groups, one mesh and material each: head, tail (tail and brake), reverse, indicatorLeft, indicatorRight. The model has no side repeaters and no third brake lamp. Left is +x, the driver's side. Chase view at the spawn, high: 90 main-pass calls at noon and at evening (budget 92). The beams are two spot lights on medium and high, off on low.
