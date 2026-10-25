# M4e car feel: rulings and deferred minors

Collected from the build ledger when M4e finished.

## Rulings

- Ruling (Mukher, 2026-10-24): the player car is a Chevrolet Gentra (Lacetti sedan); physics box and drivetrain unchanged.
- Ruling: no Sketchfab model was placed in the repo by Mukher when M4e started, so Task 3 builds the Gentra in code from carGeometry('lacetti'), with no badge; a later drop of the CC-BY Lacetti model (uzb_rx7) can replace it; cost if wrong: a less exact body until then.
- Ruling: Task 3 (Gentra body, lean; src/vehicle carModel/bodyLean/vehicle, README) runs in parallel with Task 1 (src/audio only); disjoint files; cost if wrong: a commit race, mitigated by staging specific paths.
- Ruling: Task 2 waits for Task 3 to commit; both touch src/main.ts; cost if wrong: a few minutes.
- Ruling: Task 4 review and Task 5 measurement run in parallel; Task 5 only measures and writes docs; cost if wrong: a re-measure after a Task 4 fix.
- Ruling: right mirror is outside the 16:9 frame at the default head pose but unobstructed and in frame at the right glance; mirror poses are fixed since M1 and a real driver turns the head too; cost if wrong: Mukher may want a wider default FOV.
- Ruling: Task 5 (measurement, docs, one tuning change in gauges/cockpit) is reviewed inside the M4e final review; the final reviewer reads the whole branch anyway; cost if wrong: one doc or tuning fix.
- Ruling: minors 2, 3, 5 (per-redraw ImageData allocation, per-step Vector3/Quaternion in updateLean, Object.assign onto the live AudioRig) join the fix pass; each is a few lines and the first two are per-frame garbage; cost if wrong: none.

## Deferred minors

- Task 1: minor (deferred): no click on stalk-off; held horn pressed during suspension stays silent until re-pressed.
- Task 3: minor (deferred): no glass-inset frame; bumper test threshold still > 2 cm; code-built body is an approximation, the CC-BY Lacetti model (uzb_rx7) can replace it if Mukher downloads it.
- Task 2: minor (deferred): no click on stalk-off; first idle read at gain 0 in headless (ctx not yet running).
- Task 4: minor (deferred): tach red zone and engine lamp partly hidden behind the wheel rim; no dispose for cockpit resources (page lifetime); one restating comment.
- Final: minor (deferred): gauge material tone-mapped (dials follow exposure); R after a manual stall plays the starter; iOS Safari voice volume read-only; rear mirror glare from M1 eye position.
- Final: minor (deferred): the evening preset reads weak in the M4d avenue and M4e cockpit shots (bright blue sky at 18:00); consider a lower, warmer evening (sun 7-10°, warmer sky) as a tuning follow-up now that streets are lit by sky ambient.
