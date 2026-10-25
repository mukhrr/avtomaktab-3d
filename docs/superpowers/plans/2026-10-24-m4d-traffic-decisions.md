# M4d traffic: rulings and deferred minors

Collected from the build ledger when M4d finished.

## Rulings

- Pre-flight: T1 CarClass/PAINT → T2 carGeometry per class; T3 AgentView.indicator → T2 lamps (T2 renders indicator lamps from a field T3 adds). Ruling: T2 adds AgentView.indicator (always null) so lamps can be wired; T3 fills it; T2 consumes a field T3 produces; cost if wrong: none.
- Ruling: Task 1 review runs in parallel with the Task 2 implementer (read-only reviewer, disjoint files); cost if wrong: Task 2 rework if CarClass changes.
- Ruling (2026-10-24, Mukher): the player car becomes a Chevrolet Gentra (Lacetti sedan) in M4e; physics box and drivetrain unchanged; README line updated in M4e Task 3.
- Ruling: the jam ring at (-230,50) (seen in seeds 1,4,7) goes to the M4d final fix pass with a root-cause look; a 4-minute standstill on route-1 is a bad player experience whatever triggers it; cost if wrong: one more traffic fix.
- Ruling: Task 5 (measurement and docs) is reviewed inside the M4d final review; the car-shadow cost goes into the final fix pass with the jam ring; both are known Important items; cost if wrong: none.
- Ruling: horn-in-queue minor (car behind honks at a player stuck behind a stopped car) re-graded into the fix pass; a horn at a player who cannot move is the spammy behaviour the plan forbids; cost if wrong: a few lines.
- Ruling: the mutual hold at (-119,-498) is fixed in the test driver, not the AI; the AI correctly waits for a car in its swept path, and a human player can drive on; cost if wrong: a human who also waits gets the 240 s last-resort despawn.
- Final: Ruling: AI heading steps at polyline vertices (an 11 m bus swings ~1 m at a bend; seed 10 careful run gets collisionCar) is pre-existing and deferred as a named follow-up for Mukher; the single final fix pass is spent and it needs heading smoothing in the AI pose, which also moves collision bodies; cost if wrong: a rare unfair collision fail beside a bus at a bend.
- Final: Ruling: seed 16 stoppedOnCrossing is a test-driver emergency-stop artefact, not a rule issue; cost if wrong: none.

## Deferred minors

- Task 1: minor (deferred): colour sequence not snapshot-tested.
- Task 2: minor (deferred): batch needs WEBGL_multi_draw for the call budget; redundant lamp colour init; bus stripe by agent id parity; lamps unlit MeshBasic.
- Task 4: minor (deferred): reversing car behind not excluded; HornMonitor matcher not reset on teleport (self-heals); dispose never called.
- Final: minor (deferred): crosser hold at a crossing has no time cap (a long-stopped car or player holds pedestrians indefinitely); suggest release after ~15 s.
- Final: minor (deferred): high gpu budget needs a quiet-machine recheck.
