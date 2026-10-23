import type { DistrictData, Vec2 } from '../shared/district';
import { SignalSystem } from '../sim/signals';
import { testNetwork } from '../traffic/testNetwork';
import type { AgentView, PlayerState } from '../traffic/trafficSim';
import { canHitPedestrian, PedSim } from './pedSim';

const DT = 1 / 30;
const AWAY: PlayerState = { position: [-40, 60], heading: 0, speed: 0, length: 4.5, width: 1.8 };

function car(position: Vec2, heading: number, speed: number): AgentView {
  return { id: 1, active: true, position, heading, carClass: 'nexia', colour: 0, braking: false, speed };
}

/** Test network with its zebra replaced by a signal crossing on edge e, 40 m from the cross. */
function signalNetwork(): DistrictData {
  const d = testNetwork();
  d.controllers.push({
    id: 'c2', offset: 0,
    phases: [[{ edgeId: 'e', dir: 1, stopAt: 37 }, { edgeId: 'e', dir: -1, stopAt: 43 }], []],
  });
  d.crossings = [{ id: 's1', position: [40, 0], kind: 'signal', edgeId: 'e', at: 40, width: 7, controllerId: 'c2', walkPhase: 1 }];
  return d;
}

function setup(d: DistrictData, opts: { crossers: number; walkers: number }) {
  const signals = new SignalSystem(d);
  const sim = new PedSim(d, { ...opts, seed: 3 });
  const step = (player = AWAY, cars: AgentView[] = []) => {
    signals.update(DT);
    sim.step(DT, player, cars, signals);
  };
  return { d, signals, sim, step };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function distToPolyline(p: Vec2, pts: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const dx = bx - ax, dz = bz - az;
    const t = Math.min(Math.max(((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz), 0), 1);
    best = Math.min(best, Math.hypot(p[0] - ax - dx * t, p[1] - az - dz * t));
  }
  return best;
}

test('a signal crosser waits through dontWalk and starts within 0.5 s of walk', () => {
  const c = setup(signalNetwork(), { crossers: 1, walkers: 0 });
  c.step();
  expect(c.signals.walkState('s1')).toBe('dontWalk');
  let walkAt = -1, startAt = -1;
  for (let i = 0; i < 40 * 30 && startAt < 0; i++) {
    c.step();
    if (walkAt < 0 && c.signals.walkState('s1') === 'walk') walkAt = c.signals.time;
    if (c.sim.occupied('s1')) startAt = c.signals.time;
    if (walkAt < 0) expect(c.sim.occupied('s1')).toBe(false);
  }
  expect(walkAt).toBeGreaterThan(0);
  expect(startAt - walkAt).toBeLessThanOrEqual(0.5);
});

test('a zebra crosser waits for a car 15 m away at 12 m/s and crosses when it is 60 m away', () => {
  const c = setup(testNetwork(), { crossers: 1, walkers: 0 });
  const near = car([-55, 0], Math.PI / 2, 12);
  c.step();
  for (let i = 0; i < 60; i++) c.step(AWAY, [near]);
  expect(c.sim.occupied('z1')).toBe(false);
  c.step(AWAY, [car([-100, 0], Math.PI / 2, 12)]);
  expect(c.sim.occupied('z1')).toBe(true);
});

test('curbWaiting is true while a crosser holds at the curb and false once it steps out', () => {
  const c = setup(testNetwork(), { crossers: 1, walkers: 0 });
  const near = car([-55, 0], Math.PI / 2, 12);
  c.step();
  for (let i = 0; i < 60; i++) c.step(AWAY, [near]);
  expect(c.sim.curbWaiting('z1')).toBe(true);
  expect(c.sim.occupied('z1')).toBe(false);
  c.step(AWAY, [car([-100, 0], Math.PI / 2, 12)]);
  expect(c.sim.curbWaiting('z1')).toBe(false);
  expect(c.sim.occupied('z1')).toBe(true);
  expect(c.sim.curbWaiting('nope')).toBe(false);
});

test('a car already past the crossing, or one stopped far away, does not block', () => {
  const c = setup(testNetwork(), { crossers: 1, walkers: 0 });
  c.step();
  c.step(AWAY, [car([-25, 0], Math.PI / 2, 12), car([-60, 0], Math.PI / 2, 0)]);
  expect(c.sim.occupied('z1')).toBe(true);
});

test('a zebra crosser ignores the player 10 m away at 12 m/s', () => {
  const c = setup(testNetwork(), { crossers: 1, walkers: 0 });
  const player: PlayerState = { position: [-50, 0], heading: Math.PI / 2, speed: 12, length: 4.5, width: 1.8 };
  c.step();
  c.step(player);
  expect(c.sim.occupied('z1')).toBe(true);
});

test('an unmarked crosser waits for the player', () => {
  const d = testNetwork();
  d.crossings = [{ id: 'u1', position: [-40, 0], kind: 'unmarked', edgeId: 'w', at: 40, width: 7 }];
  const c = setup(d, { crossers: 1, walkers: 0 });
  const player: PlayerState = { position: [-70, 0], heading: Math.PI / 2, speed: 12, length: 4.5, width: 1.8 };
  c.step();
  for (let i = 0; i < 30; i++) c.step(player);
  expect(c.sim.occupied('u1')).toBe(false);
  c.step({ ...player, position: [-120, 0] });
  expect(c.sim.occupied('u1')).toBe(true);
});

/** Parks the player across the crossing at `centre` for 30 s, then moves it away for 30 s. */
function parkOnCrossing(d: DistrictData, centre: Vec2, crossers: number) {
  const c = setup(d, { crossers, walkers: 0 });
  c.step();
  const start = c.sim.peds.filter(p => p.active).map(p => ({ id: p.id, side: Math.sign(p.position[1]) }));
  const parked: PlayerState = { position: [centre[0], 1.75], heading: Math.PI / 2, speed: 0, length: 4.5, width: 1.8 };
  for (let i = 0; i < 30 * 30; i++) {
    c.step(parked);
    expect(c.sim.hitTest(parked)).toEqual([]);
  }
  const crossed = new Set<number>();
  for (let i = 0; i < 30 * 30; i++) {
    c.step();
    for (const s of start) if (Math.sign(c.sim.peds[s.id].position[1]) === -s.side) crossed.add(s.id);
  }
  return { start, crossed };
}

test('zebra crossers pause while a stopped player blocks their way, then cross', () => {
  const { start, crossed } = parkOnCrossing(testNetwork(), [-40, 0], 6);
  expect(start.length).toBe(6);
  expect(crossed.size).toBe(6);
});

test('signal crossers pause while a stopped player blocks their way, then cross', () => {
  const { start, crossed } = parkOnCrossing(signalNetwork(), [40, 0], 6);
  expect(start.length).toBe(6);
  expect(crossed.size).toBe(6);
});

test('occupied is true only while the crosser is on the carriageway', () => {
  const c = setup(testNetwork(), { crossers: 1, walkers: 0 });
  c.step();
  const ped = c.sim.peds.find(p => p.active)!;
  const centre: Vec2 = [-40, 0];
  const half = 3 / 2 + 1.5;
  let sawOn = false, sawOff = false;
  for (let i = 0; i < 20 * 30 && !(sawOn && sawOff); i++) {
    c.step();
    if (!ped.active) break;
    const onRoad = Math.abs(ped.position[1] - centre[1]) < half - 1e-6;
    expect(c.sim.occupied('z1')).toBe(onRoad);
    if (onRoad) sawOn = true;
    else if (sawOn) sawOff = true;
  }
  expect(sawOn).toBe(true);
  expect(sawOff).toBe(true);
});

test('hitTest reports a pedestrian at the front bumper and not one 2 m to the side', () => {
  const c = setup(testNetwork(), { crossers: 0, walkers: 1 });
  c.step();
  const ped = c.sim.peds.find(p => p.active)!;
  const player: PlayerState = { position: [ped.position[0], ped.position[1]], heading: 0, speed: 0, length: 4.5, width: 1.8 };
  const place = (ahead: number, side: number): PlayerState => ({
    ...player, position: [ped.position[0] - side, ped.position[1] - ahead],
  });
  expect(c.sim.hitTest(place(2.25, 0))).toEqual([ped.id]);
  expect(c.sim.hitTest(place(0, 2))).toEqual([]);
  c.sim.remove(ped.id);
  expect(c.sim.hitTest(place(0, 0))).toEqual([]);
});

test('only a player moving faster than 1 m/s either way can hit a pedestrian', () => {
  expect([0, 0.5, 1, -1, 1.5, -1.5].map(canHitPedestrian)).toEqual([false, false, false, false, true, true]);
});

test('walkers stay on footway polylines and walk at 1.1 to 1.5 m/s', () => {
  const c = setup(testNetwork(), { crossers: 0, walkers: 30 });
  const fw = c.d.roads.find(r => r.id === 'fw1')!.points;
  for (let i = 0; i < 30; i++) c.step();
  expect(c.sim.peds.filter(p => p.active).length).toBe(30);
  for (let n = 0; n < 200; n++) {
    const before = c.sim.peds.map(p => [...p.position] as Vec2);
    c.step();
    c.sim.peds.forEach((p, i) => {
      expect(distToPolyline(p.position, fw)).toBeLessThan(0.5);
      const nearEnd = p.position[0] < -118 || p.position[0] > -12;
      if (!nearEnd && p.walking) {
        const v = dist(p.position, before[i]) / DT;
        expect(v).toBeGreaterThan(1.1 - 1e-6);
        expect(v).toBeLessThan(1.5 + 1e-6);
      }
    });
  }
});

test('crossers spawn at curb ends of a crossing 40 m or more from the player', () => {
  const player: PlayerState = { position: [-40, 50], heading: 0, speed: 0, length: 4.5, width: 1.8 };
  const c = setup(testNetwork(), { crossers: 20, walkers: 0 });
  c.step(player);
  const active = c.sim.peds.filter(p => p.active);
  expect(active.length).toBe(20);
  for (const p of active) {
    expect(Math.abs(p.position[1])).toBeCloseTo(3, 5);
    expect(Math.abs(p.position[0] + 40)).toBeLessThanOrEqual(1);
  }
});

test('no crossers spawn at a crossing closer than 40 m to the player', () => {
  const c = setup(testNetwork(), { crossers: 5, walkers: 0 });
  c.step({ ...AWAY, position: [-40, 30] });
  expect(c.sim.peds.filter(p => p.active).length).toBe(0);
});

test('walkers spawn at least 40 m from the player', () => {
  const player: PlayerState = { ...AWAY, position: [-60, -6] };
  const c = setup(testNetwork(), { crossers: 0, walkers: 30 });
  const seen = new Set<number>();
  for (let i = 0; i < 60; i++) {
    c.step(player);
    for (const p of c.sim.peds) {
      if (!p.active || seen.has(p.id)) continue;
      seen.add(p.id);
      expect(dist(p.position, player.position)).toBeGreaterThanOrEqual(40);
    }
  }
  expect(seen.size).toBeGreaterThan(0);
});

test('no crossers spawn when every crossing is beyond 150 m', () => {
  const c = setup(testNetwork(), { crossers: 5, walkers: 0 });
  c.step({ ...AWAY, position: [300, 100] });
  expect(c.sim.peds.filter(p => p.active).length).toBe(0);
});

test('crossers finish, despawn and are replaced', () => {
  const c = setup(testNetwork(), { crossers: 4, walkers: 0 });
  for (let i = 0; i < 40 * 30; i++) {
    c.step();
    expect(c.sim.peds.filter(p => p.active).length).toBe(4);
  }
});

function crossingFootwayNetwork(): DistrictData {
  const d = testNetwork();
  d.roads.push({ id: 'fw2', kind: 'footway', width: 2, lanes: 0, oneway: false, name: '', maxspeed: 0, points: [[-60, -20], [-60, 20]] });
  return d;
}

test('walkers never stand on the carriageway of a road their footway crosses', () => {
  const c = setup(crossingFootwayNetwork(), { crossers: 0, walkers: 40 });
  let northSide = false, southSide = false;
  for (let i = 0; i < 60 * 30; i++) {
    c.step();
    for (const p of c.sim.peds) {
      if (!p.active || Math.abs(p.position[0] + 60) > 1) continue;
      expect(Math.abs(p.position[1])).toBeGreaterThanOrEqual(3.5);
      if (p.position[1] < 0) northSide = true;
      else southSide = true;
    }
  }
  expect(northSide && southSide).toBe(true);
});

test('spawning does nothing without footways in range and is capped per step', () => {
  const c = setup(testNetwork(), { crossers: 0, walkers: 80 });
  c.step({ ...AWAY, position: [300, 100] });
  expect(c.sim.peds.filter(p => p.active).length).toBe(0);
  expect(c.sim.spawnAttempts).toBe(0);
  c.step({ ...AWAY, position: [-60, 30] });
  expect(c.sim.spawnAttempts).toBeGreaterThan(0);
  expect(c.sim.spawnAttempts).toBeLessThanOrEqual(20);
});

describe('clearNear', () => {
  it('removes pedestrians within the radius and keeps the rest', () => {
    const { sim, step } = setup(testNetwork(), { crossers: 0, walkers: 20 });
    for (let i = 0; i < 5; i++) step();
    const active = sim.peds.filter(p => p.active);
    expect(active.length).toBeGreaterThan(1);
    const centre = active[0].position.slice() as Vec2;
    sim.clearNear(centre, 15);
    for (const p of sim.peds) if (p.active) expect(dist(p.position, centre)).toBeGreaterThanOrEqual(15);
    expect(sim.peds.some(p => p.active)).toBe(active.some(p => dist(p.position, centre) >= 15));
  });
});

test('crossers leaving a crossing next to a junction stay off every carriageway', () => {
  const d = testNetwork();
  d.crossings = [{ id: 'j1', position: [-8, 0], kind: 'zebra', edgeId: 'w', at: 8, width: 7 }];
  const c = setup(d, { crossers: 20, walkers: 0 });
  const roads = d.roads.filter(r => r.kind !== 'footway');
  let leftBand = 0;
  for (let i = 0; i < 60 * 30; i++) {
    c.step();
    for (const p of c.sim.peds) {
      if (!p.active || Math.abs(p.position[0] + 8) <= 2.5) continue;
      leftBand++;
      for (const r of roads) expect(distToPolyline(p.position, r.points)).toBeGreaterThan(r.width / 2);
    }
  }
  expect(leftBand).toBeGreaterThan(0);
});
