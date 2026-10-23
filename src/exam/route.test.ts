import { describe, expect, it } from 'vitest';
import { LaneNetwork, type LaneRef } from '../traffic/lanes';
import { testNetwork } from '../traffic/testNetwork';
import type { DistrictData } from '../shared/district';
import { classifyTurn, planRoute, snapWaypoint, type ExamRoute } from './route';

const deg = (d: number) => (d * Math.PI) / 180;
const same = (a: LaneRef, b: LaneRef) => a.edgeId === b.edgeId && a.dir === b.dir && a.lane === b.lane;

describe('classifyTurn', () => {
  it('splits at 30 and 150 degrees', () => {
    expect(classifyTurn(0, deg(29))).toBe('straight');
    expect(classifyTurn(0, deg(-29))).toBe('straight');
    expect(classifyTurn(0, deg(31))).not.toBe('straight');
    expect(classifyTurn(0, deg(149))).not.toBe('uturn');
    expect(classifyTurn(0, deg(151))).toBe('uturn');
    expect(classifyTurn(0, deg(-151))).toBe('uturn');
  });

  it('eastbound turning south is a right turn (x east, z south)', () => {
    expect(classifyTurn(Math.PI / 2, 0)).toBe('right');
    expect(classifyTurn(Math.PI / 2, Math.PI)).toBe('left');
  });

  it('wraps across +-PI', () => {
    expect(classifyTurn(deg(170), deg(-170))).toBe('straight');
  });
});

describe('snapWaypoint', () => {
  it('picks the travel direction from the side of the street', () => {
    const d = testNetwork(), net = new LaneNetwork(d);
    // w runs from the cross westward; the south side carries traffic eastbound, toward the cross.
    expect(snapWaypoint(net, d, [-100, 3]).ref).toEqual({ edgeId: 'w', dir: -1, lane: 0 });
    expect(snapWaypoint(net, d, [-100, -3]).ref).toEqual({ edgeId: 'w', dir: 1, lane: 0 });
  });
});

describe('planRoute', () => {
  // West arm eastbound, straight over the signalled cross, right at the T into the stub.
  const plan = (): { d: DistrictData; net: LaneNetwork; route: ExamRoute } => {
    const d = testNetwork(), net = new LaneNetwork(d);
    return { d, net, route: planRoute(net, d, [[-100, 3], [120, 3], [237, 30]]) };
  };

  it('returns contiguous steps from start to finish', () => {
    const { net, route } = plan();
    const { steps } = route;
    expect(steps.map(s => s.ref.edgeId)).toEqual(['w', 'e', 'tStub']);
    expect(steps[0].maneuver).toBe('start');
    expect(steps.at(-1)!.maneuver).toBe('finish');
    for (let i = 1; i < steps.length; i++) expect(net.exits(steps[i - 1].ref).some(r => same(r, steps[i].ref))).toBe(true);
    expect(steps[1]).toMatchObject({ maneuver: 'right', nodeId: 't' });
  });

  it('records which waypoint each step leads toward', () => {
    const { route } = plan();
    expect(route.waypoints).toHaveLength(3);
    expect(route.steps.map(s => s.waypointIndex)).toEqual([1, 2, 2]);
  });

  it('starts on the lane at the first waypoint and measures the driven length', () => {
    const { route } = plan();
    expect(route.start.position[0]).toBeCloseTo(-100, 0);
    expect(route.start.heading).toBeCloseTo(Math.PI / 2, 1);
    // About 100 m to the cross, 240 m to the T, 30 m into the stub.
    expect(route.lengthM).toBeGreaterThan(340);
    expect(route.lengthM).toBeLessThan(400);
  });

  it('turns around at a dead end when the next waypoint is behind', () => {
    const d = testNetwork(), net = new LaneNetwork(d);
    const route = planRoute(net, d, [[237, 10], [243, 10]]);
    expect(route.steps.map(s => [s.ref.edgeId, s.ref.dir])).toEqual([['tStub', 1], ['tStub', -1]]);
    expect(route.steps[0].maneuver).toBe('start');
  });

  it('throws when a waypoint cannot be reached', () => {
    const d = testNetwork(), net = new LaneNetwork(d);
    // o1 runs one way north into a dead end with no lane back.
    expect(() => planRoute(net, d, [[361, -40], [0, 60]])).toThrow(/waypoint 1/);
  });

  it('counts a signalled straight, an unsignalled turn and the zebra', () => {
    const { route } = plan();
    expect(route.features).toMatchObject({
      signalledStraight: 1, signalledLeft: 0, signalledRight: 0, zebras: 1, signalCrossings: 0,
      unsignalledPriorityRight: 0, multiLaneTurns: 0, speedZones: 0, stopSigns: 0, giveWaySigns: 0,
    });
  });

  it('counts priority to the right only when a road arrives from the right', () => {
    const d = testNetwork(), net = new LaneNetwork(d);
    // Westbound on tE, the stub at the T sits on the left; eastbound on e it sits on the right.
    const west = planRoute(net, d, [[300, -3], [120, -3]]);
    expect(west.features.unsignalledPriorityRight).toBe(0);
    expect(planRoute(net, d, [[120, 3], [300, 3]]).features.unsignalledPriorityRight).toBe(1);
  });

  it('ignores yard exits on the right', () => {
    const d = testNetwork();
    d.roads.find(r => r.id === 'tStub')!.kind = 'service';
    const route = planRoute(new LaneNetwork(d), d, [[120, 3], [300, 3]]);
    expect(route.features.unsignalledPriorityRight).toBe(0);
  });

  it('counts signal crossings, multi-lane turns and speed changes', () => {
    const d = structuredClone(testNetwork());
    const e = d.graph.edges.find(x => x.id === 'e')!;
    e.lanesForward = 2;
    e.width = 10.5;
    d.graph.edges.find(x => x.id === 'tStub')!.maxspeed = 40;
    d.crossings.push({ id: 'p1', position: [120, 0], kind: 'signal', edgeId: 'e', at: 120, width: 10.5 });
    const net = new LaneNetwork(d);
    const route = planRoute(net, d, [[-100, 3], [120, 4], [237, 30]]);
    expect(route.features).toMatchObject({ signalCrossings: 1, multiLaneTurns: 1, speedZones: 1 });
  });
});
