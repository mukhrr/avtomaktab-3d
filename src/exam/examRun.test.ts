import type { Vec2 } from '../shared/district';
import { landmarkColliders } from '../shared/landmark';
import { shelterBoxes } from '../world/furniture';
import { LAMP_SEED, lampPositions } from '../world/streetside';
import { loadWorld, runExam } from './testDriver';

// Same traffic as main.ts: 60 cars (seed 1), 40 crossers and 80 walkers (seed 2).
const world = () => loadWorld({ cars: 60, crossers: 40, walkers: 80 });
const RUN_TIMEOUT = 60_000;

describe('exam runs on route-1 with M2 traffic (headless)', () => {
  it('a careful driver finishes and passes with 0 to 10 points', () => {
    const w = world();
    const path: Vec2[] = [];
    const { result, signalling, prompts, replanFailures } = runExam(w, { indicators: true, obeyLights: true }, { watch: s => path.push(s.position) });
    expect(result.violations.map(v => v.id)).toEqual([]);
    // The car never leaves the route, so the matcher must never make the examiner think it did.
    expect(prompts.filter(p => p.key === 'exam.reroute')).toEqual([]);
    expect(replanFailures).toBe(0);
    expect(result.phase).toBe('finished');
    expect(result.passed).toBe(true);
    expect(result.total).toBeLessThanOrEqual(10);
    expect(signalling).toEqual([]);
    // Lamp colliders are off the carriageway, so the careful path must never come near one.
    const lamps = lampPositions(w.d, LAMP_SEED);
    expect(path.length).toBeGreaterThan(1000);
    const closest = path.reduce((best, [x, z]) => lamps.reduce((b, l) => Math.min(b, Math.hypot(l.x - x, l.z - z)), best), Infinity);
    expect(closest).toBeGreaterThan(1);
    // A shelter's half-length is 2 m and it stands 1.5 m beyond the kerb, so the path stays clear of it.
    const shelters = shelterBoxes(w.d);
    const nearestShelter = path.reduce((best, [x, z]) => shelters.reduce((b, s) => Math.min(b, Math.hypot(s.x - x, s.z - z)), best), Infinity);
    expect(nearestShelter).toBeGreaterThan(3);
    const solids = landmarkColliders(w.d);
    expect(solids.length).toBe(5);
    const nearestSolid = path.reduce((best, [x, z]) => solids.reduce((b, s) => Math.min(b, Math.hypot(s.x - x, s.z - z) - s.radius), best), Infinity);
    expect(nearestSolid).toBeGreaterThan(3);
  }, RUN_TIMEOUT);

  it('a driver who runs red lights fails on redLight', () => {
    const { result } = runExam(world(), { indicators: true, obeyLights: false });
    expect(result.phase).toBe('failed');
    expect(result.passed).toBe(false);
    // Every violation is listed, so a new one before the red light would show here.
    expect(result.violations.map(v => v.id)).toEqual(['redLight']);
  }, RUN_TIMEOUT);

  it('a driver who never indicates gets one noIndicator per signalled maneuver', () => {
    const w = world();
    const { result, signalling, driver } = runExam(w, { indicators: false, obeyLights: true }, { driveOn: true });

    // Turns are the route's left, right and U-turn steps; straight-through steps carry no indicator duty
    // (ManeuverWatch gives them side null). Lane changes are maneuvers too: on 22813507:0, 2 to reach the rightmost
    // lane for the first pass's right turn and 3 to reach the leftmost for the second pass's left turn.
    const turnSteps = w.route.steps.filter(s => s.maneuver === 'left' || s.maneuver === 'right' || s.maneuver === 'uturn');
    expect(turnSteps).toHaveLength(6);
    expect(driver.laneChanges).toBe(5);
    const missed = signalling.filter(v => v.id === 'noIndicator');
    const kinds = missed.map(v => String(v.detail?.maneuver));
    // In route order, each turn's miss names that step's own direction.
    expect(kinds.filter(k => !k.startsWith('lane-'))).toEqual(turnSteps.map(s => s.maneuver));
    expect(kinds.filter(k => k.startsWith('lane-'))).toHaveLength(driver.laneChanges);
    // The pull-off from the kerb is its own, lighter penalty.
    expect(signalling.filter(v => v.id === 'noIndicatorPullOff')).toHaveLength(1);

    // At 20 points each the exam is lost on the fifth miss; up to then the session charged exactly the same ones.
    expect(result.phase).toBe('failed');
    const charged = result.violations.filter(v => v.id === 'noIndicator');
    expect(charged).toHaveLength(5);
    expect(charged.map(v => v.t)).toEqual(missed.slice(0, 5).map(v => v.t));
    expect(result.violations.every(v => v.id === 'noIndicator' || v.id === 'noIndicatorPullOff')).toBe(true);
  }, RUN_TIMEOUT);
});
