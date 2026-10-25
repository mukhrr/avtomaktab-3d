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
