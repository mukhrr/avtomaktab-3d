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

/** Test network plus a controller on e (dir 1) that is red for the first 15 s, its stop line at `stopAt(net)`. */
function redOnE(stopAtFor: (net: LaneNetwork) => number) {
  const d = testNetwork();
  const net = new LaneNetwork(d);
  d.controllers.push({ id: 'cE', offset: 0, phases: [[], [{ edgeId: 'e', dir: 1, stopAt: stopAtFor(net) }]] });
  const signals = new SignalSystem(d);
  const sim = new TrafficSim(d, net, signals, { count: 0, seed: 1 });
  const step = () => {
    signals.update(DT);
    sim.step(DT, AWAY, FREE);
  };
  return { net, signals, sim, step };
}

test('a stop line before the lane start holds a turning car before it enters the lane', () => {
  const c = redOnE(() => 0);
  expect(c.net.path(E).startAt).toBeGreaterThan(0);
  expect(c.signals.approachState('n', -1, 100)!.state).toBe('green');
  const id = c.sim.place(N, c.net.path(N).length - 30, { carClass: 'nexia', speed: 8, route: [E] });
  for (let t = 0; t < 12; t += DT) {
    c.step();
    const st = c.sim.inspect(id)!;
    expect(st.ref.edgeId === 'e' && st.connectorNode === null).toBe(false);
  }
  expect(c.sim.agents[id].speed).toBeLessThan(0.1);
});

test('a stop line past the lane end holds the car before the junction', () => {
  const c = redOnE(net => net.path(E).endAt + 6);
  const id = c.sim.place(E, c.net.path(E).length - 40, { carClass: 'nexia', speed: 8, route: [{ edgeId: 'tE', dir: 1, lane: 0 }] });
  const len = c.net.path(E).length;
  for (let t = 0; t < 12; t += DT) {
    c.step();
    const st = c.sim.inspect(id)!;
    expect(st.connectorNode).toBeNull();
    expect(st.s + NEXIA / 2).toBeLessThan(len);
  }
  expect(c.sim.agents[id].speed).toBeLessThan(0.1);
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

test('stops for a person on an unmarked crossing', () => {
  const d = testNetwork();
  d.crossings = [{ ...d.crossings[0], id: 'u1', kind: 'unmarked' }];
  const net = new LaneNetwork(d);
  const signals = new SignalSystem(d);
  const sim = new TrafficSim(d, net, signals, { count: 0, seed: 1 });
  const occupied: CrossingOccupancy = { occupied: id => id === 'u1' };
  const id = sim.place(W, 10, { carClass: 'nexia' });
  for (let t = 0; t < 20; t += DT) {
    signals.update(DT);
    sim.step(DT, AWAY, occupied);
    expect(net.edgeS(W, sim.inspect(id)!.s + NEXIA / 2)).toBeGreaterThan(40 + 1.5);
  }
  expect(sim.agents[id].speed).toBeLessThan(0.1);
});

test('a car already inside the 3 m setback of an occupied zebra still stops before it', () => {
  const c = setup();
  const occupied: CrossingOccupancy = { occupied: id => id === 'z1' };
  const id = c.sim.place(W, c.net.pathS(W, 41.5) - NEXIA / 2, { carClass: 'nexia', speed: 3 });
  for (let t = 0; t < 5; t += DT) {
    c.step(AWAY, occupied);
    expect(c.net.edgeS(W, c.sim.inspect(id)!.s + NEXIA / 2)).toBeGreaterThan(40);
  }
  expect(c.sim.agents[id].speed).toBeLessThan(0.1);
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

test('a reservation whose holder has been stuck on the connector for 6 s is released and the next car goes', () => {
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
  let entered = 0, stopped = 0;
  for (let t = 0; t < 20 && !entered; t += DT) {
    c.step(player);
    expect(c.sim.inspect(stuck)!.connectorNode).toBe('t');
    if (!stopped && c.sim.agents[stuck].speed < 0.5) stopped = c.signals.time;
    if (c.sim.inspect(next)!.connectorNode === 't') entered = c.signals.time;
  }
  expect(stopped).toBeGreaterThan(0);
  expect(entered - stopped).toBeGreaterThan(6);
  expect(entered - stopped).toBeLessThan(10);
});

/** Drives one agent from w into the cross and reports whether it took a reservation there. */
function reservesCross(d: DistrictData): boolean {
  const net = new LaneNetwork(d);
  const signals = new SignalSystem(d);
  const sim = new TrafficSim(d, net, signals, { count: 0, seed: 1 });
  signals.update(26);
  const id = sim.place(W, net.path(W).length - 10, { carClass: 'nexia', speed: 6, route: [E] });
  let reserved = false;
  for (let t = 0; t < 5; t += DT) {
    signals.update(DT);
    sim.step(DT, AWAY, FREE);
    if (sim.reservationHolder('cross') === id) reserved = true;
  }
  return reserved;
}

test('a junction whose every arriving arm has a stop line within 40 m is not reservation-gated', () => {
  expect(reservesCross(testNetwork())).toBe(false);
});

test('a junction with an arm whose stop line is 100 m back is reservation-gated', () => {
  const d = testNetwork();
  const n = d.controllers[0].phases.flat().find(a => a.edgeId === 'n')!;
  n.stopAt = 100;
  expect(reservesCross(d)).toBe(true);
});

test('a junction with an arriving arm that has no controller approach is reservation-gated', () => {
  const d = testNetwork();
  d.controllers[0].phases[0] = d.controllers[0].phases[0].filter(a => a.edgeId !== 's');
  expect(reservesCross(d)).toBe(true);
});

test('a junction whose arms are split between two controllers is reservation-gated', () => {
  const d = testNetwork();
  const [ns, we] = d.controllers[0].phases;
  d.controllers = [{ id: 'c1', offset: 0, phases: [ns, []] }, { id: 'c2', offset: 17, phases: [we, []] }];
  expect(reservesCross(d)).toBe(true);
});

test('a junction covered only by a standalone pedestrian-light controller is reservation-gated', () => {
  const d = testNetwork();
  d.controllers[0].id = 'ped-c1';
  expect(reservesCross(d)).toBe(true);
});

test('a same-approach stream over 10 s never shares a wide unsignalled T, and the cross approach still gets through', () => {
  const d = testNetwork();
  // Wide arms give 26 m connectors, long enough for a platoon to keep the reservation held without a break.
  for (const e of d.graph.edges) if (['e', 'tE', 'tStub'].includes(e.id)) e.width = 20;
  const net = new LaneNetwork(d);
  const signals = new SignalSystem(d);
  const sim = new TrafficSim(d, net, signals, { count: 0, seed: 1 });
  const westbound: LaneRef = { edgeId: 'tE', dir: -1, lane: 0 };
  const intoStub: LaneRef = { edgeId: 'tStub', dir: 1, lane: 0 };
  const len = net.path(westbound).length;
  const stream = Array.from({ length: 12 }, (_, i) =>
    sim.place(westbound, len - 4.5 - i * 7, { carClass: 'nexia', speed: 4, route: [intoStub] }));
  const cross = sim.place(E, net.path(E).length - 30, { carClass: 'nexia', speed: 6, route: [{ edgeId: 'tE', dir: 1, lane: 0 }] });
  const ids = [...stream, cross];
  let streamOnNode = 0, crossEntered = -1;
  for (let t = 0; t < 40; t += DT) {
    signals.update(DT);
    sim.step(DT, AWAY, FREE);
    const on = ids.filter(id => sim.inspect(id)?.connectorNode === 't');
    const approaches = new Set(on.map(id => { const r = sim.inspect(id)!.ref; return `${r.edgeId}|${r.dir}`; }));
    expect(approaches.size).toBeLessThanOrEqual(1);
    if (on.some(id => id !== cross)) streamOnNode += DT;
    if (crossEntered < 0 && on.includes(cross)) crossEntered = t;
  }
  expect(streamOnNode).toBeGreaterThan(10);
  expect(crossEntered).toBeGreaterThanOrEqual(0);
  expect(crossEntered).toBeLessThan(15);
});
