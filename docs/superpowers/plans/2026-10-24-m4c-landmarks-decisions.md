# M4c landmarks: rulings and deferred minors

Collected from the build ledger on 2026-10-24 when M4c finished.

## Rulings

- Ruling: plans for M4c-M4e are written and executed without waiting for plan approval; Mukher's goal says finish all phases without pausing; cost if wrong: a plan he would have changed gets built.
- Ruling: no downloads in M4c-M4e; models, textures and sounds are generated in code; downloads need per-file approval and Freesound needs an account; cost if wrong: synthesised engine sound is less realistic than recorded loops.
- Ruling: Task 1 review runs in parallel with the Task 2 implementer; the reviewer is read-only and Task 2 only creates new files; cost if wrong: Task 2 reworks if the landmark type changes.
- Ruling: Task 3 review and Task 4 measurement run in parallel; Task 4 only measures and writes docs unless tuning is needed; cost if wrong: a re-measure after a Task 3 fix.
- Ruling: Task 4 (docs-only measurement) is reviewed inside the M4c final review instead of its own task review; the diff is one perf doc section and the final reviewer reads it anyway; cost if wrong: one doc fix later.
- Ruling: high gpu budget accepted on deltas (+0 to 0.3 ms over M4b's 7.6) with a re-measure on a quiet machine noted for Mukher; the machine was busy with his own Chrome; cost if wrong: high misses 8 ms by up to 0.3 ms at noon chase; first lever is chunk size or lathe segments.

## Deferred minors

- Task 1: minor (deferred): any node override gets radius 6; TDD saw only missing-module failure.
- Task 2: minor (deferred): museum dome flat-shaded; tests don't cover jet count, colonnade facing, pedestal height, hotel uv tiling; a few restating comments; Kuranty arches painted not recessed.
- Task 3: minor (deferred): landmark colliders sit 0.09 m lower than lamps/shelters; lamp collider test uses magic half-height 4; buildLandmark only used in tests; gpu p95 not measured in Task 3 (Task 4 measures).
- Final: minor (deferred): monument collider r 6 is wider than the visible pedestal; Amir Temur facing set toward (0,0) not verified against panoramas.
