# Avtomaktab 3D

A browser driving game on the real streets of central Tashkent, built for practising the Uzbek category B city driving test. An examiner sits in the passenger seat, gives directions in Uzbek or Russian, and scores you by Uzbek road rules (YHQ).

Scoring is labelled "practice scoring" until a driving instructor has reviewed the rules. It is not an official exam replica.

## What's in it

- About 2 × 1.5 km around Amir Temur square, built from OpenStreetMap
- A Chevrolet Gentra (3D model "Lacetti" by uzb_rx7, CC-BY-4.0) with automatic and manual gearbox, cockpit view and working mirrors
- AI traffic, traffic lights and pedestrians
- An exam route of 3.8 km with 25 scored rules, voice directions and a debrief map of your mistakes
- Free drive with no scoring

## Run it

Needs Node 20 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Add `?debug` to the URL for frame timing.

Controls: W/S or arrows to drive, A/D to steer, Z/X indicators, V hazard lights, B seat belt, 1/2/3 mirror glances, C camera, R reset, Esc menu, H help.

## Develop

```bash
npm test
npm run build
npm run city:build    # rebuild the district from OpenStreetMap data
```

Design notes and plans are in `docs/`.

## Credits and licence

Code: MIT, see `LICENSE`.

Map data © OpenStreetMap contributors (ODbL). Other assets and their licences are listed in `CREDITS.md`.
