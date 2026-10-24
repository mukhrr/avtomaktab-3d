# M4a light and materials: rulings and deferred minors

Collected from the build ledger on 2026-10-24 when M4a finished. Rulings are decisions made during the build, each with what it costs if wrong. Deferred minors are review findings left for later.

## Rulings

- Ruling: T5's rewrite of environment.ts keeps the ground plane material T4 introduces (createGroundMaterials().ground); the two tasks touch the same file in order; cost if wrong: ground reverts to flat colour, caught in T5 review.
- Ruling: Task 2 evening azimuth bound (280°-300°) is a plan estimate; if NOAA gives a value just outside, the implementer may widen the bound to the computed value ±5° and say so; the test's intent is "west-northwest low sun"; cost if wrong: none.
- Ruling: CPU frame time in a throttled pane includes up to 5 fixed sim steps per frame (fixedSteps cap), so it overstates a 60 fps frame; Task 7 must report cpu split into sim steps and render work (or steps per frame alongside) before judging the 8 ms budget; cost if wrong: tuning chases a measurement artefact.
- Ruling: Tasks 2 and 3 batched into one implementer and one review; both are small pure modules with no shared files; cost if wrong: one larger review.
- Ruling: buildWorld's third parameter is the ground materials record (created once in main.ts) instead of QualitySettings; avoids a double texture load; cost if wrong: Task 5/6 pass materials instead of settings.
- Ruling: evening moved from 18:45 to 18:00 local (sun 7.5° -> 15.7°); at 7.5° the street was too dark for a driving exam; still clearly low and warm; cost if wrong: evening less dramatic; plan/brief text says 18:45.
- Ruling: Task 7 may tile merged buildings and tree instances into ~150-200 m chunks and try shadowFar 300 and PCFShadowMap before cutting map size; reviewer's estimates put these at the largest GPU wins, ahead of the plan's tuning order; cost if wrong: extra draw calls from tiling must stay under 120.
- Ruling: probe uses p90 of render-only samples instead of the plan's p95 of whole frames; whole-frame CPU includes catch-up sim steps (Task 1 ruling) and one hitch could save Low; cost if wrong: a slightly optimistic preset pick.
- Ruling: low preset budget is judged against the pre-M4a cost (M3: 61 calls, gpu as measured unthrottled), not half of high; the timer's noise floor on the M5 is ~3.4 ms on a near-empty frame, so "half of 8 ms" is below what can be measured, and low is meant to look and cost like M3; low = M3 + 1 sky call; cost if wrong: low is not lighter than M3 on weak laptops.

## Deferred minors

- Task 1: minor (deferred): GPU poll returns only newest of a drained burst; GPU sample lags frames (inherent).
- Tasks 2-3: minor (deferred): no separate test for setItem quota throw; light preset values untuned until Task 5/7.
- Task 4: minor (deferred): import order in main.ts; brief untextured flash while textures load.
- Task 5: minor (deferred): signal poles cast no shadow (pre-existing); mirrors show no shadows far behind the car; evening asphalt dark near the car; morning sky pale toward the sun.
- Task 6: minor (deferred): window.__game.start bypasses the pickers; cold-probe Start-disabled state not seen live.
- Task 7: minor (deferred): AI car reads ~36% brighter than M3; a first-visit probe picking low keeps medium materials until reload; low morning/evening hemi scaled, not measured; noon horizon pale band; repeated same-frame setTimeOfDay logs glGetProgramiv warnings.
- Final: minor (deferred): mirror targets 8-bit with no tone mapping may clip bright cars/sky; ui.reloadForAA key name; __game.start during probe.
