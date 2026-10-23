import type { DistrictData, Vec2 } from '../shared/district';
import { SignalSystem } from '../sim/signals';
import { LaneNetwork, pointAt, type LaneRef } from './lanes';
import { testNetwork } from './testNetwork';
import { CAR_CLASSES, TrafficSim, type CrossingOccupancy, type PlayerState } from './trafficSim';

const DT = 1 / 60;
const NEXIA = CAR_CLASSES.nexia.length;
const AWAY: PlayerState = { position: [100, 60], heading: 0, speed: 0, length: 4.5, width: 1.8 };
const FREE: CrossingOccupancy = { occupied: () => false };

function setup(count = 0, seed = 1) {
  const d = testNetwork();
  const net = new LaneNetwork(d);
  const signals = new SignalSystem(d);
  const sim = new TrafficSim(d, net, signals, { count, seed });
  const step = (player = AWAY, crossings = FREE) => {
    signals.update(DT);
    sim.step(DT, player, crossings);
  };
  return { d, net, signals, sim, step };
}

function stopAt(d: DistrictData, edgeId: string): number {
  return d.controllers[0].phases.flat().find(a => a.edgeId === edgeId)!.stopAt;
}

function corners(c: Vec2, heading: number, length: number, width: number): Vec2[] {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const rx = -fz, rz = fx;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [
    c[0] + fx * a * length / 2 + rx * b * width / 2,
    c[1] + fz * a * length / 2 + rz * b * width / 2,
  ]);
}

function boxesOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i], q = poly[(i + 1) % 4];
      const nx = -(q[1] - p[1]), nz = q[0] - p[0];
      const proj = (pts: Vec2[]) => pts.map(v => v[0] * nx + v[1] * nz);
      const pa = proj(a), pb = proj(b);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

const N: LaneRef = { edgeId: 'n', dir: -1, lane: 0 };
const S: LaneRef = { edgeId: 's', dir: -1, lane: 0 };
const W: LaneRef = { edgeId: 'w', dir: -1, lane: 0 };
const E: LaneRef = { edgeId: 'e', dir: 1, lane: 0 };

test('stops 0.5 to 4 m before a red stop line, holds while red, goes within 6 s of green', () => {
  const c = setup();
  c.signals.update(26);
  const lineS = c.net.pathS(N, stopAt(c.d, 'n'));
  const id = c.sim.place(N, lineS - 60 - NEXIA / 2, { carClass: 'nexia', route: [S] });
  let front = Infinity;
  while (c.signals.time < 51.99) {
    c.step();
    const st = c.sim.inspect(id)!;
    expect(st.connectorNode).toBeNull();
    front = lineS - (st.s + NEXIA / 2);
    expect(front).toBeGreaterThan(0);
  }
  expect(front).toBeGreaterThanOrEqual(0.5);
  expect(front).toBeLessThanOrEqual(4);
  while (c.signals.time < 52.01) c.step();
  let t = 0;
  while (c.sim.inspect(id)!.connectorNode === null && t < 6) {
    c.step();
    t += DT;
  }
  expect(t).toBeLessThan(6);
});

test('dilemma zone: 10 m from the line at 14 m/s when yellow starts, it continues through', () => {
  const c = setup();
  c.signals.update(21);
  const lineS = c.net.pathS(N, stopAt(c.d, 'n'));
  const id = c.sim.place(N, lineS - 10 - NEXIA / 2, { carClass: 'nexia', speed: 14, route: [S] });
  let t = 0, minSpeed = Infinity;
  while (c.sim.inspect(id)!.connectorNode === null && t < 2) {
    c.step();
    t += DT;
    minSpeed = Math.min(minSpeed, c.sim.agents[id].speed);
  }
  expect(c.sim.inspect(id)!.connectorNode).toBe('cross');
  expect(minSpeed).toBeGreaterThan(12);
});

test('yellow with room to stop: 40 m out at 14 m/s it stops before the line', () => {
  const c = setup();
  c.signals.update(21);
  const lineS = c.net.pathS(N, stopAt(c.d, 'n'));
  const id = c.sim.place(N, lineS - 40 - NEXIA / 2, { carClass: 'nexia', speed: 14, route: [S] });
  for (let t = 0; t < 15; t += DT) {
    c.step();
    expect(c.sim.inspect(id)!.connectorNode).toBeNull();
  }
  expect(c.sim.agents[id].speed).toBeLessThan(0.1);
});

test('queues behind a stationary player 50 m ahead in its lane without touching it', () => {
  const c = setup();
  const path = c.net.path(E);
  const p = pointAt(path.points, 70);
  const player: PlayerState = { position: p.position, heading: p.heading, speed: 0, length: 4.5, width: 1.8 };
  const id = c.sim.place(E, 20, { carClass: 'nexia' });
  for (let t = 0; t < 20; t += DT) {
    c.step(player);
    const st = c.sim.inspect(id)!;
    expect(70 - st.s - NEXIA / 2 - player.length / 2).toBeGreaterThanOrEqual(1.5);
    const a = c.sim.agents[id];
    expect(boxesOverlap(corners(a.position, a.heading, NEXIA, CAR_CLASSES.nexia.width),
      corners(player.position, player.heading, player.length, player.width))).toBe(false);
  }
  expect(c.sim.agents[id].speed).toBeLessThan(0.1);
  expect(70 - c.sim.inspect(id)!.s - NEXIA / 2 - player.length / 2).toBeLessThan(5);
});

test('queues behind a player standing inside the cross on its connector path', () => {
  const c = setup();
  c.signals.update(26);
  const player: PlayerState = { position: [0, 1.75], heading: Math.PI / 2, speed: 0, length: 4.5, width: 1.8 };
  const startX = c.net.path(W).points[0][0];
  const id = c.sim.place(W, -50 - startX, { carClass: 'nexia', route: [E] });
  let gap = Infinity;
  for (let t = 0; t < 20; t += DT) {
    c.step(player);
    const a = c.sim.agents[id];
    gap = (player.position[0] - player.length / 2) - (a.position[0] + NEXIA / 2);
    expect(gap).toBeGreaterThanOrEqual(1.5);
    expect(boxesOverlap(corners(a.position, a.heading, NEXIA, CAR_CLASSES.nexia.width),
      corners(player.position, player.heading, player.length, player.width))).toBe(false);
  }
  expect(c.sim.agents[id].speed).toBeLessThan(0.1);
  expect(gap).toBeLessThan(5);
});

test('three agents queued behind a red light keep 1.5 m gaps and their order', () => {
  const c = setup();
  c.signals.update(26);
  const lineS = c.net.pathS(N, stopAt(c.d, 'n'));
  const ids = [30, 45, 60].map(back => c.sim.place(N, lineS - back, { carClass: 'nexia' }));
  while (c.signals.time < 49.9) {
    c.step();
    const s = ids.map(id => c.sim.inspect(id)!.s);
    for (let i = 1; i < 3; i++) {
      expect(s[i]).toBeLessThan(s[i - 1]);
      expect(s[i - 1] - s[i] - NEXIA).toBeGreaterThanOrEqual(1.5);
    }
  }
  expect(Math.max(...ids.map(id => c.sim.agents[id].speed))).toBeLessThan(0.1);
});

/** Steps the sim, asserting that agents on connectors of `node` all come from one approach. */
function runExclusive(c: ReturnType<typeof setup>, node: string, ids: number[], seconds: number) {
  const visited = new Set<number>(), passed = new Set<number>();
  for (let t = 0; t < seconds && passed.size < ids.length; t += DT) {
    c.step();
    const on = ids.filter(id => c.sim.inspect(id)?.connectorNode === node);
    const approaches = new Set(on.map(id => { const r = c.sim.inspect(id)!.ref; return `${r.edgeId}|${r.dir}`; }));
    expect(approaches.size).toBeLessThanOrEqual(1);
    if (on.length) expect(on).toContain(c.sim.reservationHolder(node));
    for (const id of ids) {
      if (on.includes(id)) visited.add(id);
      else if (visited.has(id)) passed.add(id);
    }
  }
  return passed;
}

test('unsignalled T: two agents arriving together never share the junction', () => {
  const c = setup();
  const eLen = c.net.path(E).length;
  const tE: LaneRef = { edgeId: 'tE', dir: -1, lane: 0 };
  const tELen = c.net.path(tE).length;
  const ids = [c.sim.place(E, eLen - 20, { speed: 8 }), c.sim.place(tE, tELen - 20, { speed: 8 })];
  expect(runExclusive(c, 't', ids, 30).size).toBe(2);
});

test('unsignalled T: four agents on all approaches at once all pass within 30 s', () => {
  const c = setup();
  const tE: LaneRef = { edgeId: 'tE', dir: -1, lane: 0 };
  const stub: LaneRef = { edgeId: 'tStub', dir: -1, lane: 0 };
  const len = (r: LaneRef) => c.net.path(r).length;
  const ids = [
    c.sim.place(E, len(E) - 15, { speed: 8 }),
    c.sim.place(E, len(E) - 30, { speed: 8 }),
    c.sim.place(tE, len(tE) - 15, { speed: 8 }),
    c.sim.place(stub, len(stub) - 15, { speed: 8 }),
  ];
  expect(runExclusive(c, 't', ids, 30).size).toBe(4);
});

test('stops for an occupied zebra and goes once it clears', () => {
  const c = setup();
  let occupied = true;
  const crossings: CrossingOccupancy = { occupied: id => id === 'z1' && occupied };
  const id = c.sim.place(W, 10, { carClass: 'nexia' });
  const frontEdgeS = () => c.net.edgeS(W, c.sim.inspect(id)!.s + NEXIA / 2);
  for (let t = 0; t < 20; t += DT) {
    c.step(AWAY, crossings);
    expect(frontEdgeS()).toBeGreaterThan(40 + 1.5);
  }
  expect(c.sim.agents[id].speed).toBeLessThan(0.1);
  occupied = false;
  let t = 0;
  while (frontEdgeS() > 40 - 1.5 && t < 10) {
    c.step(AWAY, crossings);
    t += DT;
  }
  expect(t).toBeLessThan(10);
});

test('an agent driving into the dead-end stub U-turns and keeps moving', () => {
  const c = setup();
  const id = c.sim.place({ edgeId: 'tStub', dir: 1, lane: 0 }, 5);
  let turned = false, maxAfter = 0;
  for (let t = 0; t < 15; t += DT) {
    c.step();
    const st = c.sim.inspect(id)!;
    if (st.ref.edgeId === 'tStub' && st.ref.dir === -1 && st.connectorNode === null) turned = true;
    if (turned) maxAfter = Math.max(maxAfter, c.sim.agents[id].speed);
  }
  expect(turned).toBe(true);
  expect(maxAfter).toBeGreaterThan(3);
  expect(c.sim.agents[id].active).toBe(true);
});

test('20 agents over 120 s never produce a NaN position', () => {
  const c = setup(20, 7);
  for (let t = 0; t < 120; t += DT) {
    c.step();
    const active = c.sim.agents.filter(a => a.active);
    expect(active).toHaveLength(20);
    for (const a of active) {
      expect(Number.isFinite(a.position[0]) && Number.isFinite(a.position[1]) && Number.isFinite(a.heading)).toBe(true);
    }
  }
});

test('spawns keep 100 m from the player and 9 m from other agents, holding the count at 30', () => {
  const c = setup(30, 3);
  const player: PlayerState = { ...AWAY, position: [-60, 40] };
  const seen = new Set<string>();
  let spawns = 0;
  for (let i = 0; i < 60 / DT; i++) {
    c.step(player);
    const active = c.sim.agents.filter(a => a.active);
    expect(active).toHaveLength(30);
    for (const a of active) {
      const k = `${a.id}:${c.sim.inspect(a.id)!.generation}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const fromPlayer = Math.hypot(a.position[0] - player.position[0], a.position[1] - player.position[1]);
      expect(fromPlayer).toBeGreaterThanOrEqual(i === 0 ? 30 : 100);
      for (const b of active) {
        if (b !== a) expect(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1])).toBeGreaterThanOrEqual(9);
      }
      if (i > 0) spawns++;
    }
  }
  expect(spawns).toBeGreaterThan(0);
});

test('a reservation held over 6 s by a car stuck on the connector is released and the next car goes', () => {
  const c = setup();
  const tE: LaneRef = { edgeId: 'tE', dir: 1, lane: 0 };
  const stub: LaneRef = { edgeId: 'tStub', dir: -1, lane: 0 };
  const p = pointAt(c.net.path(tE).points, 3);
  const player: PlayerState = { position: p.position, heading: p.heading, speed: 0, length: 4.5, width: 1.8 };
  const stuck = c.sim.place(E, c.net.path(E).length - 10, { carClass: 'nexia', speed: 6, route: [tE] });
  let held = 0;
  for (let t = 0; t < 4 && held === 0; t += DT) {
    c.step(player);
    if (c.sim.reservationHolder('t') === stuck) held = c.signals.time;
  }
  expect(held).toBeGreaterThan(0);
  const next = c.sim.place(stub, c.net.path(stub).length - 15, { carClass: 'nexia', speed: 6, route: [{ edgeId: 'e', dir: -1, lane: 0 }] });
  let entered = 0;
  for (let t = 0; t < 12 && !entered; t += DT) {
    c.step(player);
    expect(c.sim.inspect(stuck)!.connectorNode).toBe('t');
    if (c.sim.inspect(next)!.connectorNode === 't') entered = c.signals.time;
  }
  expect(entered - held).toBeGreaterThan(6);
  expect(entered - held).toBeLessThan(10);
});
