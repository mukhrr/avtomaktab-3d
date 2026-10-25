import { describe, expect, it } from 'vitest';
import type { DistrictData, Sign } from '../../src/shared/district';
import { planRoute, type ExamRoute } from '../../src/exam/route';
import { LaneNetwork } from '../../src/traffic/lanes';
import { testNetwork } from '../../src/traffic/testNetwork';
import { freeSpots, routeConflicts } from './coverageSpots';

const sign = (code: string, edgeId: string, dir: 1 | -1, at: number, o: Partial<Sign> = {}): Sign =>
  ({ id: `c-${code}-${edgeId}-${at}`, code, edgeId, dir, at, origin: 'coverage', ...o });

// West arm eastbound, straight over the signalled cross, right at the T into the stub.
function setup(waypoints: [number, number][] = [[-100, 3], [120, 3], [237, 30]], signs: Sign[] = []) {
  const d: DistrictData = { ...testNetwork(), signs };
  const net = new LaneNetwork(d);
  const route: ExamRoute = planRoute(net, d, waypoints, 'r');
  return { d, net, route };
}

describe('freeSpots', () => {
  it('lists free spots along a route at 15 m spacing, avoiding existing poles', () => {
    const { d, route } = setup(undefined, [sign('3.24', 'w', -1, 60, { value: 40, origin: 'rule' })]);
    const spots = freeSpots(d, [route]);
    const on = (edgeId: string, dir: number, side = 'right') => spots.filter(s => s.edgeId === edgeId && s.dir === dir && s.side === side).map(s => s.at);
    // w runs from the cross, so eastbound is dir -1 and the start sits 100 m along it.
    expect(on('w', -1)).toEqual([90, 75, 45, 30, 15]);
    expect(on('e', 1)).toHaveLength(15);
    expect(on('e', -1)).toEqual([]);
    expect(spots.find(s => s.edgeId === 'e' && s.at === 225)).toMatchObject({ routeIds: ['r'], beforeJunction: 15 });
    expect(on('tStub', 1).every(at => at <= 30)).toBe(true);
  });

  it('skips a spot on the other carriageway side that shares a kerb with an existing pole', () => {
    const { d, route } = setup(undefined, [sign('5.15', 'w', 1, 60, { side: 'left' })]);
    expect(freeSpots(d, [route]).filter(s => s.edgeId === 'w' && s.dir === -1).map(s => s.at)).toEqual([90, 75, 45, 30, 15]);
  });

  it('merges a spot two routes share', () => {
    const { d, net, route } = setup();
    const other = planRoute(net, d, [[-100, 3], [120, 3]], 'r2');
    expect(freeSpots(d, [route, other]).find(s => s.edgeId === 'w' && s.at === 30)?.routeIds).toEqual(['r', 'r2']);
  });
});

describe('routeConflicts', () => {
  it('flags a no-entry on a lane the route drives', () => {
    const { d, net, route } = setup();
    expect(routeConflicts(sign('3.1', 'e', 1, 100), [route], net, d)).toHaveLength(1);
    expect(routeConflicts(sign('3.1', 'e', -1, 100), [route], net, d)).toEqual([]);
    // Behind the start: the route never drives that part of w.
    expect(routeConflicts(sign('3.1', 'w', -1, 110), [route], net, d)).toEqual([]);
  });

  it('flags a no-entry near the entry of a later edge even when the route finishes short of it', () => {
    const { d, net, route } = setup([[-100, 3], [120, 3], [237, 10]]);
    expect(route.steps.at(-1)!.ref.edgeId).toBe('tStub');
    expect(routeConflicts(sign('3.1', 'tStub', 1, 30), [route], net, d)).toHaveLength(1);
  });

  it('flags cycle tracks, footpaths and eco zones on a driven lane', () => {
    const { d, net, route } = setup();
    for (const code of ['4.5', '4.6', '3.35']) expect(routeConflicts(sign(code, 'e', 1, 100), [route], net, d)).toHaveLength(1);
  });

  it('flags shared and segregated pedestrian-cycle paths on a driven lane, though they are not car signs', () => {
    const { d, net, route } = setup();
    for (const code of ['4.6.1', '4.6.2', '4.6.3', '4.6.4', '4.6.5', '4.6.6']) {
      expect(routeConflicts(sign(code, 'e', 1, 100), [route], net, d), code).toHaveLength(1);
      expect(routeConflicts(sign(code, 'e', -1, 100), [route], net, d), code).toEqual([]);
    }
  });

  // The examiner has no right-on-red exception, so a driver obeying 5.42 would run a red light.
  it('flags right turn on red on a signalled approach the route drives', () => {
    const { d, net, route } = setup();
    expect(routeConflicts(sign('5.42', 'w', -1, 30), [route], net, d)).toHaveLength(1);
    expect(routeConflicts(sign('5.42', 'e', 1, 220), [route], net, d)).toEqual([]);
  });

  it('flags a no-left-turn where the route turns left', () => {
    const { d, net, route } = setup([[300, -3], [237, 30]]);
    expect(route.steps.map(s => s.ref.edgeId)).toEqual(['tE', 'tStub']);
    expect(routeConflicts(sign('3.18.2', 'tE', -1, 20), [route], net, d)[0]).toMatch(/left/);
    expect(routeConflicts(sign('3.18.1', 'tE', -1, 20), [route], net, d)).toEqual([]);
    // Too far from the junction to govern it.
    expect(routeConflicts(sign('3.18.2', 'tE', -1, 50), [route], net, d)).toEqual([]);
  });

  it('flags a straight-only sign where the route turns right', () => {
    const { d, net, route } = setup();
    expect(routeConflicts(sign('4.1.1', 'e', 1, 220), [route], net, d)[0]).toMatch(/right/);
    expect(routeConflicts(sign('4.1.1', 'w', -1, 10), [route], net, d)).toEqual([]);
    expect(routeConflicts(sign('4.1.4', 'e', 1, 220), [route], net, d)).toEqual([]);
  });

  it('does not flag a truck-only ban for the Gentra', () => {
    const { d, net, route } = setup();
    expect(routeConflicts(sign('3.4', 'e', 1, 100, { value: 3.5 }), [route], net, d)).toEqual([]);
  });

  it('flags a height limit lower than the Gentra', () => {
    const { d, net, route } = setup();
    expect(routeConflicts(sign('3.13', 'e', 1, 100, { value: 1.4 }), [route], net, d)).toHaveLength(1);
    expect(routeConflicts(sign('3.13', 'e', 1, 100, { value: 4 }), [route], net, d)).toEqual([]);
  });

  it('flags a coverage speed limit below 20 and a minimum speed above 40, wherever they stand', () => {
    const { d, net, route } = setup();
    expect(routeConflicts(sign('3.24', 'n', 1, 50, { value: 10 }), [route], net, d)).toHaveLength(1);
    expect(routeConflicts(sign('3.24', 'n', 1, 50, { value: 10, origin: 'rule' }), [route], net, d)).toEqual([]);
    expect(routeConflicts(sign('4.7', 'n', 1, 50, { value: 50 }), [route], net, d)).toHaveLength(1);
    expect(routeConflicts(sign('4.7', 'n', 1, 50, { value: 30 }), [route], net, d)).toEqual([]);
  });

  it('leaves no-overtaking and no-stopping signs alone', () => {
    const { d, net, route } = setup();
    for (const code of ['3.20', '3.22', '3.27', '3.28', '3.29', '3.30']) expect(routeConflicts(sign(code, 'e', 1, 100), [route], net, d)).toEqual([]);
  });
});
