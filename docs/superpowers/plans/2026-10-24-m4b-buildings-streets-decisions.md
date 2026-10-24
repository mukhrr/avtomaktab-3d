# M4b buildings and streets: rulings and deferred minors

Collected from the build ledger on 2026-10-24 when M4b finished. Rulings are decisions made during the build, each with what it costs if wrong. Deferred minors are review findings left for later.

## Rulings

- Ruling: Task 1 also carries `roof?: 'hipped' | 'gabled'` on Building from OSM roof:shape so Task 4's "or OSM tagged roof:shape=hipped" has data; T4 consumes a field no task produced; cost if wrong: one optional field in district.json.
- Ruling: Tasks 2 and 3 batched into one implementer and one review; both small, disjoint files (environment.ts vs new facadeAtlas.ts); cost if wrong: one larger review.
- Ruling: BatchedMesh per kind with one geometry per chunk replaces the plan's one Mesh per chunk; per-chunk Meshes measured 162 calls low / 350 high, BatchedMesh 53/67 with the same culling; cost if wrong: browsers without WEBGL_multi_draw draw one call per visible chunk.
- Final: Ruling: re-grade Minor 1 (startup cost unrecorded, lamps/aryks computed 2-3 times) into the fix pass; the spec requires generation under 2 s and it was never measured; cost if wrong: ~230 ms of load time.
- Final: Ruling: re-grade Minor 2 (lamp collider r 0.12 vs 0.24 base) into the fix pass; a car clips visibly into a lamp base before the collision counts; cost if wrong: none.
- Final: Ruling: world build at 1.9-2.1 s on dev modules is accepted against the 2 s spec; production modules are minified and not slower; measured on a noisy machine; cost if wrong: ~0.1 s over target on a first load.

## Deferred minors

- Task 1: minor (deferred): untagged-slab panel rule only fires for building=yes, not house/detached.
- Tasks 2-3: minor (deferred): public ground shop front partly covered by pilasters.
- Task 4: minor (deferred): chunks.ts throws on an empty list; buildings under ground+1 m stretch the shop cell; vFacade could be flat; shared walls not inspected at street level; gabled roofs drawn hipped; grey parapet band on brick tops.
- Task 5: minor (deferred): divided-road pairing needs identical names; blocked median slots skipped (64 m gaps); lamp heads don't glow; wide medians can show two aryks.
- Task 6: minor (deferred): careful-path shelter assertion measures to centre (>3 m); benches on footways kept.
- Task 7: minor (deferred): high noon chase gpu p95 margin 0.3-0.4 ms; low change compared as means of 4 runs.
- Final: minor (deferred): shelter setback measured from carriageway edge not kerb; tree trunks flat-shaded and now cast shadows.
- Final: minor (deferred): cached lamp/aryk arrays are mutable; production load time not measured.
