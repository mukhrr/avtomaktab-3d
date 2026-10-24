import type { DistrictData, Sign, Vec2 } from '../shared/district';
import { SignalSystem } from '../sim/signals';
import { LaneNetwork, pointAt, type LaneRef } from './lanes';
import { testNetwork } from './testNetwork';
import { CAR_CLASSES, TrafficSim, type CrossingOccupancy, type PlayerState } from './trafficSim';

const DT = 1 / 60;
const HALF = CAR_CLASSES.nexia.length / 2;
const AWAY: PlayerState = { position: [100, 60], heading: 0, speed: 0, length: 4.5, width: 1.8 };
const FREE: CrossingOccupancy = { occupied: () => false };

// T at t (240,0): e arrives eastbound, tE westbound, the stub northbound from the dead end d.
const E: LaneRef = { edgeId: 'e', dir: 1, lane: 0 };
const TE_OUT: LaneRef = { edgeId: 'tE', dir: 1, lane: 0 };
const STUB_IN: LaneRef = { edgeId: 'tStub', dir: -1, lane: 0 };
const E_BACK: LaneRef = { edgeId: 'e', dir: -1, lane: 0 };
// Cross at (0,0): n southbound, s northbound, w eastbound arrive; exits run the other way.
const N_IN: LaneRef = { edgeId: 'n', dir: -1, lane: 0 };
const S_IN: LaneRef = { edgeId: 's', dir: 1, lane: 0 };
const W_IN: LaneRef = { edgeId: 'w', dir: -1, lane: 0 };
const E_IN: LaneRef = { edgeId: 'e', dir: -1, lane: 0 };
const N_OUT: LaneRef = { edgeId: 'n', dir: 1, lane: 0 };
const S_OUT: LaneRef = { edgeId: 's', dir: -1, lane: 0 };
const W_OUT: LaneRef = { edgeId: 'w', dir: 1, lane: 0 };

const sign = (id: string, type: Sign['type'], edgeId: string, dir: 1 | -1, at: number): Sign => ({ id, type, edgeId, dir, at });

function setup(edit: (d: DistrictData) => void = () => {}, seed = 1) {
  const d = testNetwork();
  edit(d);
  const net = new LaneNetwork(d);
  const signals = new SignalSystem(d);
  const sim = new TrafficSim(d, net, signals, { count: 0, seed });
  const len = (r: LaneRef) => net.path(r).length;
  /** Places a nexia whose front is `front` metres short of the lane end. */
  const at = (ref: LaneRef, front: number, speed: number, route: LaneRef[] = []) =>
    sim.place(ref, len(ref) - front - HALF, { carClass: 'nexia', speed, route });
  const step = (player = AWAY, crossings = FREE) => {
    signals.update(DT);
    sim.step(DT, player, crossings);
  };
  return { d, net, signals, sim, len, at, step };
}

/** Seconds until each agent first stands on a connector of `node`, or Infinity. */
function entryTimes(c: ReturnType<typeof setup>, node: string, ids: number[], seconds: number, player?: (t: number) => PlayerState) {
  const entered = ids.map(() => Infinity);
  for (let t = 0; t < seconds && entered.some(x => x === Infinity); t += DT) {
    c.step(player?.(t));
    ids.forEach((id, i) => {
      if (entered[i] === Infinity && c.sim.inspect(id)?.connectorNode === node) entered[i] = t;
    });
  }
  return entered;
}

const giveWayOnStub = (d: DistrictData) => { d.signs = [sign('gw', 'giveWay', 'tStub', -1, 8)]; };

test('give way: the side arm waits for a main-road car 2 s out even though it reaches the line first', () => {
  const c = setup(giveWayOnStub);
  const side = c.at(STUB_IN, 4, 4, [E_BACK]);
  const main = c.at(E, 24, 12, [TE_OUT]);
  const [sideIn, mainIn] = entryTimes(c, 't', [side, main], 20);
  expect(mainIn).toBeLessThan(sideIn);
  expect(sideIn).toBeLessThan(20);
});

test('give way: the side arm goes when the main-road car is 5 s out', () => {
  const c = setup(giveWayOnStub);
  const side = c.at(STUB_IN, 4, 4, [E_BACK]);
  const main = c.at(E, 60, 12, [TE_OUT]);
  const [sideIn, mainIn] = entryTimes(c, 't', [side, main], 20);
  expect(sideIn).toBeLessThan(mainIn);
});

test('equal approaches: the car from the right goes first even when it arrives second', () => {
  const c = setup();
  const fromWest = c.at(E, 4, 4, [TE_OUT]);
  const fromSouth = c.at(STUB_IN, 20, 8, [E_BACK]);
  const [westIn, southIn] = entryTimes(c, 't', [fromWest, fromSouth], 20);
  expect(southIn).toBeLessThan(westIn);
  expect(westIn).toBeLessThan(20);
});

test('a priority road beats an unsigned arm that has it on its right', () => {
  const c = setup(d => { d.signs = [sign('pr', 'priorityRoad', 'e', 1, 230)]; });
  const main = c.at(E, 4, 4, [TE_OUT]);
  const side = c.at(STUB_IN, 20, 8, [E_BACK]);
  const [mainIn, sideIn] = entryTimes(c, 't', [main, side], 20);
  expect(mainIn).toBeLessThan(sideIn);
});

test('a lower-priority car waits for the player approaching on the main road', () => {
  const c = setup(giveWayOnStub);
  const side = c.at(STUB_IN, 4, 4, [E_BACK]);
  const path = c.net.path(E);
  const player = (t: number): PlayerState => {
    const s = Math.min(path.length + 30, path.length - 26 + 12 * t);
    const p = s <= path.length ? pointAt(path.points, s) : pointAt(c.net.path(TE_OUT).points, s - path.length);
    return { position: p.position, heading: p.heading, speed: 12, length: 4.5, width: 1.8 };
  };
  const [sideIn] = entryTimes(c, 't', [side], 20, player);
  // The player's front reaches the junction at about 2 s.
  expect(sideIn).toBeGreaterThan(2);
  expect(sideIn).toBeLessThan(20);
});

test('left turn on green waits for an oncoming straight car 2 s out', () => {
  const c = setup();
  expect(c.signals.approachState('s', 1, 100)!.state).toBe('green');
  const left = c.at(S_IN, 1.5, 2, [W_OUT]);
  const oncoming = c.at(N_IN, 24, 12, [S_OUT]);
  const [leftIn, oncomingIn] = entryTimes(c, 'cross', [left, oncoming], 15);
  expect(oncomingIn).toBeLessThan(leftIn);
  expect(leftIn).toBeLessThan(15);
});

test('left turn on green goes when the oncoming straight car is 5 s out', () => {
  const c = setup();
  const left = c.at(S_IN, 1.5, 2, [W_OUT]);
  const oncoming = c.at(N_IN, 60, 12, [S_OUT]);
  const [leftIn, oncomingIn] = entryTimes(c, 'cross', [left, oncoming], 15);
  expect(leftIn).toBeLessThan(oncomingIn);
});

test('left turn on green waits for the oncoming player going straight', () => {
  const c = setup();
  const left = c.at(S_IN, 1.5, 2, [W_OUT]);
  const path = c.net.path(N_IN);
  const player = (t: number): PlayerState => {
    const s = Math.min(path.length - 3, path.length - 26 + 12 * t);
    const p = pointAt(path.points, s);
    return { position: p.position, heading: p.heading, speed: s < path.length - 3 ? 12 : 0, length: 4.5, width: 1.8 };
  };
  let entered = Infinity;
  for (let t = 0; t < 2; t += DT) {
    c.step(player(t));
    if (c.sim.inspect(left)!.connectorNode === 'cross') entered = t;
  }
  expect(entered).toBe(Infinity);
});

test('an AI car comes to a full stop at a stop sign before entering', () => {
  const c = setup(d => { d.signs = [sign('st', 'stop', 'e', 1, 230)]; });
  const id = c.at(E, 40, 10, [TE_OUT]);
  let rest = 0, longest = 0, entered = Infinity;
  for (let t = 0; t < 20 && entered === Infinity; t += DT) {
    c.step();
    if (c.sim.inspect(id)!.connectorNode === 't') entered = t;
    else {
      rest = c.sim.agents[id].speed < 0.3 ? rest + DT : 0;
      longest = Math.max(longest, rest);
    }
  }
  expect(longest).toBeGreaterThanOrEqual(0.5);
  expect(entered).toBeLessThan(20);
});

test('four equal approaches do not deadlock: one goes within 10 s and all pass', () => {
  const c = setup(d => {
    d.controllers = [];
    d.signals = [];
  });
  const ids = [
    c.at(N_IN, 3, 4, [S_OUT]),
    c.at(S_IN, 3, 4, [N_OUT]),
    c.at(W_IN, 3, 4, [{ edgeId: 'e', dir: 1, lane: 0 }]),
    c.at(E_IN, 3, 4, [W_OUT]),
  ];
  const entered = entryTimes(c, 'cross', ids, 60);
  expect(Math.min(...entered)).toBeLessThan(10);
  expect(Math.max(...entered)).toBeLessThan(60);
});

/** Links the far ends of n, w and s so none of the cross's exits is a dead end that route choice would skip. */
function ringArms(d: DistrictData): void {
  const pos = new Map(d.graph.nodes.map(n => [n.id, n.position]));
  for (const [id, from, to] of [['nw', 'n', 'w'], ['ws', 'w', 's']]) {
    d.graph.edges.push({
      id, from, to, roadId: id, points: [pos.get(from)!, pos.get(to)!], nodeIds: [from, to],
      lanesForward: 1, lanesBackward: 1, width: 7, maxspeed: 60, name: id,
    });
    for (const n of d.graph.nodes) if (n.id === from || n.id === to) n.edges.push(id);
  }
}

describe('route choice obeys signs', () => {
  const destinations = (signs: Sign[]) => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const c = setup(d => {
        ringArms(d);
        d.signs = signs;
      }, seed);
      c.signals.update(26);
      const id = c.at(W_IN, 30, 8);
      for (let t = 0; t < 12; t += DT) {
        c.step();
        const st = c.sim.inspect(id);
        if (st && st.connectorNode === null && st.ref.edgeId !== 'w') {
          seen.add(st.ref.edgeId);
          break;
        }
      }
    }
    return seen;
  };

  it('picks all three exits without signs', () => {
    expect([...destinations([])].sort()).toEqual(['e', 'n', 's']);
  });

  it('never turns left past a no-left-turn sign or into a no-entry street', () => {
    expect([...destinations([sign('nl', 'noLeftTurn', 'w', -1, 10), sign('ne', 'noEntry', 'e', 1, 5)])]).toEqual(['s']);
  });
});

function corners(c: Vec2, heading: number, length: number, width: number): Vec2[] {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [
    c[0] + fx * a * length / 2 - fz * b * width / 2,
    c[1] + fz * a * length / 2 + fx * b * width / 2,
  ]);
}

function boxesOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i], q = poly[(i + 1) % 4];
      const nx = -(q[1] - p[1]), nz = q[0] - p[0];
      const pa = a.map(v => v[0] * nx + v[1] * nz), pb = b.map(v => v[0] * nx + v[1] * nz);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

const box = (c: ReturnType<typeof setup>, id: number) => {
  const a = c.sim.agents[id];
  return corners(a.position, a.heading, CAR_CLASSES.nexia.length, CAR_CLASSES.nexia.width);
};

test('a higher-ranked car that cannot clear the next junction does not hold up a lower-ranked car with a free exit', () => {
  // x pulled to 12 m from t, so tE is too short to wait on and its room depends on x being free.
  const c = setup(d => {
    const x: Vec2 = [252, 0];
    d.graph.nodes.find(n => n.id === 'x')!.position = x;
    for (const e of d.graph.edges) {
      if (e.id === 'tE') e.points = [[240, 0], x];
      if (e.id === 'o1') e.points = [x, [360, -80]];
      if (e.id === 'o2') e.points = [[372, -80], [372, -10], x];
    }
    d.signs = [sign('pr', 'priorityRoad', 'e', 1, 230)];
  });
  const O1: LaneRef = { edgeId: 'o1', dir: 1, lane: 0 }, O2: LaneRef = { edgeId: 'o2', dir: 1, lane: 0 };
  expect(c.len(TE_OUT)).toBeLessThan(CAR_CLASSES.nexia.length + 2.5);
  // The player standing on o1 strands a car on x's connector, holding x for the o2 approach.
  const p = pointAt(c.net.path(O1).points, 6);
  const player: PlayerState = { position: p.position, heading: p.heading, speed: 0, length: 4.5, width: 1.8 };
  const stuck = c.at(O2, 4, 5, [O1]);
  for (let t = 0; t < 4; t += DT) c.step(player);
  expect(c.sim.inspect(stuck)!.connectorNode).toBe('x');
  const main = c.at(E, 3, 2, [TE_OUT]);
  const side = c.at(STUB_IN, 3, 2, [E_BACK]);
  const [sideIn, mainIn] = entryTimes(c, 't', [side, main], 8, () => player);
  expect(sideIn).toBeLessThan(4);
  expect(mainIn).toBe(Infinity);
  expect(c.sim.inspect(stuck)!.connectorNode).toBe('x');
});

test('a side-road car too close to stop when a main-road car appears brakes no harder than 9 m/s² and never overlaps it', () => {
  const c = setup(giveWayOnStub);
  const side = c.at(STUB_IN, 1, 8, [E_BACK]);
  const main = c.at(E, 24, 12, [TE_OUT]);
  let prev = c.sim.agents[side].speed, hardest = 0;
  for (let t = 0; t < 10; t += DT) {
    c.step();
    const v = c.sim.agents[side].speed;
    hardest = Math.max(hardest, (prev - v) / DT);
    prev = v;
    expect(boxesOverlap(box(c, side), box(c, main))).toBe(false);
  }
  expect(hardest).toBeLessThanOrEqual(9 + 1e-6);
});

test('an oncoming straight car parked for 20 s does not hold a left-turner', () => {
  // A zebra just inside s, past the cross, keeps the southbound car standing at the junction.
  const c = setup(d => {
    const s = d.graph.edges.find(e => e.id === 's')!;
    const at = Math.hypot(s.points[1][0] - s.points[0][0], s.points[1][1] - s.points[0][1]) - 12;
    d.crossings.push({ id: 'zs', position: [0, 12], kind: 'zebra', edgeId: 's', at, width: 3 });
  });
  const blocked: CrossingOccupancy = { occupied: id => id === 'zs' };
  const oncoming = c.at(N_IN, 10, 4, [S_OUT]);
  for (let t = 0; t < 10; t += DT) c.step(AWAY, blocked);
  expect(c.sim.agents[oncoming].speed).toBeLessThan(0.1);
  const left = c.at(S_IN, 1.5, 2, [W_OUT]);
  let entered = Infinity;
  for (let t = 0; t < 10 && entered === Infinity; t += DT) {
    c.step(AWAY, blocked);
    if (c.sim.inspect(left)!.connectorNode === 'cross') entered = t;
  }
  expect(c.sim.agents[oncoming].speed).toBeLessThan(0.1);
  expect(entered).toBeLessThan(5);
});
