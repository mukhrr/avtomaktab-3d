import type { DistrictData, Vec2 } from '../shared/district';
import { SignalSystem } from '../sim/signals';
import { SignSystem } from '../sim/signs';
import { LaneNetwork, type LaneRef } from '../traffic/lanes';
import { testNetwork } from '../traffic/testNetwork';
import { TrafficSim } from '../traffic/trafficSim';
import { newCabin } from '../vehicle/cabin';
import type { DrivetrainState } from '../vehicle/drivetrain';
import { MapMatcher } from './mapMatch';
import { buildSnapshot, type SnapshotContext, type SnapshotInput } from './snapshot';

const DT = 1 / 30;
const EAST = Math.PI / 2;
const NOBODY = { occupied: () => false, curbWaiting: () => false };

function setup(d: DistrictData = testNetwork(), peds: SnapshotContext['peds'] = NOBODY) {
  const net = new LaneNetwork(d);
  const signals = new SignalSystem(d);
  const signs = new SignSystem(d);
  const traffic = new TrafficSim(d, net, signals, { count: 0, seed: 1 }, signs);
  const ctx: SnapshotContext = { d, net, matcher: new MapMatcher(d, net), signals, signs, peds, traffic, playerLength: 4.5 };
  const drivetrain: DrivetrainState = { gearbox: 'manual', gear: 2, rpm: 2500, running: true };
  const input = (position: Vec2, heading: number, over: Partial<SnapshotInput> = {}): SnapshotInput => ({
    t: 12, dt: DT, position, heading, speed: 8, prevSpeed: 7.9, drivetrain, cabin: newCabin(), steer: 0.2, events: [], ...over,
  });
  return { d, net, signals, traffic, ctx, input, snap: (p: Vec2, h: number, over?: Partial<SnapshotInput>) => buildSnapshot(ctx, input(p, h, over)) };
}

const stopAt = (d: DistrictData, edgeId: string) => d.controllers[0].phases.flat().find(a => a.edgeId === edgeId)!.stopAt;

test('copies the player and cabin state and derives acceleration from the previous speed', () => {
  const c = setup();
  const s = c.snap([-60, 1.75], EAST, { speed: 8, prevSpeed: 7.7 });
  expect(s).toMatchObject({ t: 12, dt: DT, position: [-60, 1.75], heading: EAST, speed: 8, gear: 2, gearbox: 'manual', running: true, steer: 0.2, events: [] });
  expect(s.accel).toBeCloseTo(0.3 / DT, 5);
  expect(s.cabin.indicator).toBeNull();
  expect(s.match.ref).toEqual({ edgeId: 'w', dir: -1, lane: 0 });
});

test('speedLimit follows the edge and a speed sign passed', () => {
  const d = testNetwork();
  d.signs.push({ id: 'sl', type: 'speedLimit', edgeId: 'w', dir: -1, at: 60, value: 40 });
  const c = setup(d);
  expect(c.snap([-90, 1.75], EAST).speedLimit).toBe(60);
  expect(c.snap([-50, 1.75], EAST).speedLimit).toBe(40);
});

test('signalAhead is the light for the matched approach with the distance to its stop line', () => {
  const c = setup();
  const s = c.snap([-1.75, -60], 0);
  expect(s.match.ref).toEqual({ edgeId: 'n', dir: -1, lane: 0 });
  expect(s.signalAhead!.state).toBe('green');
  expect(s.signalAhead!.stopAt).toBeCloseTo(stopAt(c.d, 'n'), 5);
  expect(s.signalAhead!.distance).toBeCloseTo(60 - stopAt(c.d, 'n'), 1);
});

test('signalAhead is null inside the junction and on an arm without a light for this direction', () => {
  const c = setup();
  expect(c.snap([0.5, 0.5], 0).signalAhead).toBeNull();
  expect(c.snap([200, 1.75], EAST).signalAhead).toBeNull();
});

test('crossingsAhead lists the zebra with its distance and occupancy, and drops it once passed', () => {
  const peds = { occupied: (id: string) => id === 'z1', curbWaiting: () => true };
  const c = setup(testNetwork(), peds);
  const s = c.snap([-100, 1.75], EAST);
  expect(s.crossingsAhead).toHaveLength(1);
  expect(s.crossingsAhead[0]).toMatchObject({ id: 'z1', kind: 'zebra', occupied: true, pedOnCarriageway: true, pedAtCurb: true });
  expect(s.crossingsAhead[0].distance).toBeCloseTo(60, 1);
  expect(c.snap([-20, 1.75], EAST).crossingsAhead).toEqual([]);
});

test('crossingsAhead on the oneway side of the road counts only crossings in the travel direction', () => {
  const c = setup();
  expect(c.snap([-100, -1.75], -EAST).crossingsAhead).toEqual([]);
});

test('signsAhead lists signs within range nearest first with their distance', () => {
  const d = testNetwork();
  d.signs.push(
    { id: 'a', type: 'giveWay', edgeId: 'w', dir: -1, at: 30 },
    { id: 'b', type: 'pedestrianCrossing', edgeId: 'w', dir: -1, at: 50 },
    { id: 'far', type: 'school', edgeId: 'w', dir: -1, at: 5 },
  );
  const s = setup(d).snap([-100, 1.75], EAST);
  expect(s.signsAhead.map(g => [g.sign.id, Math.round(g.distance)])).toEqual([['b', 50], ['a', 70]]);
});

test('leader is the nearest car ahead in the lane with a bumper gap', () => {
  const c = setup();
  c.traffic.place({ edgeId: 'w', dir: -1, lane: 0 }, 30, { speed: 5, carClass: 'nexia' });
  c.traffic.place({ edgeId: 'w', dir: 1, lane: 0 }, 40, { speed: 5, carClass: 'nexia' });
  const player = c.net.path({ edgeId: 'w', dir: -1, lane: 0 }).points[0];
  const s = c.snap([player[0] + 0, player[1]], EAST);
  expect(s.leader).not.toBeNull();
  expect(s.leader!.speed).toBeCloseTo(5, 5);
  expect(s.leader!.distance).toBeGreaterThan(20);
  expect(s.leader!.distance).toBeLessThan(40);
});

test('leader ignores oncoming cars and cars beside or behind', () => {
  const c = setup();
  c.traffic.place({ edgeId: 'w', dir: 1, lane: 0 }, 60, { speed: 5 });
  c.traffic.place({ edgeId: 'w', dir: -1, lane: 0 }, 20, { speed: 5 });
  const s = c.snap([-60, 1.75], EAST);
  expect(s.leader).toBeNull();
});

const SOUTH_ARM: LaneRef = { edgeId: 's', dir: 1, lane: 0 };
const EAST_ARM: LaneRef = { edgeId: 'e', dir: -1, lane: 0 };
const NORTH_ARM: LaneRef = { edgeId: 'n', dir: -1, lane: 0 };

function conflictSetup(d: DistrictData = testNetwork()) {
  const c = setup(d);
  const place = (ref: LaneRef, toEnd: number, speed: number) =>
    c.traffic.place(ref, c.net.path(ref).length - toEnd, { speed });
  return { ...c, place };
}

test('junctionConflicts lists cars on the other arms with side, oncoming and time to arrival', () => {
  const c = conflictSetup();
  const right = c.place(SOUTH_ARM, 20, 10);
  const oncoming = c.place(EAST_ARM, 30, 5);
  const left = c.place(NORTH_ARM, 15, 0);
  const s = c.snap([-30, 1.75], EAST);
  expect(s.junctionConflicts).toHaveLength(3);
  const by = (id: number) => s.junctionConflicts.find(x => x.agentId === id)!;
  expect(by(right)).toMatchObject({ fromRight: true, oncoming: false });
  expect(by(right).tta).toBeCloseTo(2, 1);
  expect(by(oncoming)).toMatchObject({ fromRight: false, oncoming: true });
  expect(by(oncoming).tta).toBeCloseTo(6, 1);
  expect(by(left)).toMatchObject({ fromRight: false, oncoming: false });
  expect(by(left).tta).toBeCloseTo(150, 0);
});

test('junctionConflicts carries each car\'s speed, approach priority rank and its turn at the junction', () => {
  const d = testNetwork();
  d.signs.push({ id: 'gw', type: 'giveWay', edgeId: 's', dir: 1, at: 110 }, { id: 'pr', type: 'priorityRoad', edgeId: 'e', dir: -1, at: 10 });
  const c = conflictSetup(d);
  const right = c.place(SOUTH_ARM, 20, 10);
  const oncoming = c.place(EAST_ARM, 30, 5);
  const left = c.place(NORTH_ARM, 15, 0);
  const s = c.snap([-30, 1.75], EAST);
  const by = (id: number) => s.junctionConflicts.find(x => x.agentId === id)!;
  expect(by(right)).toMatchObject({ speed: 10, rank: 0 });
  expect(by(oncoming)).toMatchObject({ speed: 5, rank: 2 });
  expect(by(left)).toMatchObject({ speed: 0, rank: 1 });
  for (const x of s.junctionConflicts) expect(['left', 'right', 'straight', 'uturn', null]).toContain(x.turn);
});

test('a crossing stays listed while the rear of the car is still on it', () => {
  const c = setup();
  expect(c.snap([-37, 1.75], EAST).crossingsAhead.map(x => x.id)).toEqual(['z1']);
});

test('junctionConflicts leaves out the own approach, far cars, and everything when no junction is near', () => {
  const c = conflictSetup();
  c.place({ edgeId: 'w', dir: -1, lane: 0 }, 60, 5);
  c.place(SOUTH_ARM, 90, 10);
  expect(c.snap([-30, 1.75], EAST).junctionConflicts).toEqual([]);
  c.place(SOUTH_ARM, 20, 10);
  expect(c.snap([-100, 1.75], EAST).junctionConflicts).toEqual([]);
});

test('junctionConflicts still lists the arms while the player is inside the junction', () => {
  const c = conflictSetup();
  const right = c.place(SOUTH_ARM, 10, 10);
  c.snap([-30, 1.75], EAST);
  const s = c.snap([0.5, 0.5], EAST);
  expect(s.match.inJunction).toBe('cross');
  expect(s.junctionConflicts.map(x => x.agentId)).toEqual([right]);
  expect(s.junctionConflicts[0].fromRight).toBe(true);
});

test('a stop line 3 m into the edge after a degree-2 node shows in signalAhead before the car reaches it', () => {
  const d = testNetwork();
  const tE = d.graph.edges.find(e => e.id === 'tE')!;
  const mk = (id: string, from: string, to: string, a: Vec2, b: Vec2) =>
    ({ ...tE, id, roadId: id, from, to, points: [a, b], nodeIds: [from, to] });
  d.graph.edges = d.graph.edges.filter(e => e.id !== 'tE').concat(mk('tE1', 't', 'm', [240, 0], [300, 0]), mk('tE2', 'm', 'x', [300, 0], [360, 0]));
  d.graph.nodes.find(n => n.id === 't')!.edges = ['e', 'tStub', 'tE1'];
  d.graph.nodes.find(n => n.id === 'x')!.edges = ['tE2', 'o1', 'o2'];
  d.graph.nodes.push({ id: 'm', position: [300, 0], edges: ['tE1', 'tE2'] });
  d.controllers.push({ id: 'c3', offset: 0, phases: [[{ edgeId: 'tE2', dir: 1, stopAt: 3 }]] });
  const c = setup(d);
  let seenAt: number | null = null;
  for (let x = 285; x < 304; x += 14 * DT) {
    const s = c.snap([x, 1.75], EAST);
    if (s.signalAhead && seenAt === null) seenAt = x;
  }
  expect(seenAt).not.toBeNull();
  expect(seenAt!).toBeLessThan(301);
});

test('reversing 10 m in the lane keeps ref and the sign of lateral through the speed threshold', () => {
  const c = setup();
  const first = c.snap([-100, 1.75], EAST, { speed: 0 });
  for (let i = 0; i <= 33; i++) {
    const speed = -2 * Math.sin((i / 33) * Math.PI) - (i % 2 ? 0.45 : 0.55);
    const s = c.snap([-100 - i * 0.3, 1.75], EAST, { speed });
    expect(s.match.ref).toEqual(first.match.ref);
    expect(s.match.lateral).toBeCloseTo(1.75, 2);
  }
});
