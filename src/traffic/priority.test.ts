import type { DistrictData, Sign } from '../shared/district';
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
  const step = (player = AWAY) => {
    signals.update(DT);
    sim.step(DT, player, FREE);
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
  const side = c.at(STUB_IN, 1, 3, [E_BACK]);
  const main = c.at(E, 24, 12, [TE_OUT]);
  const [sideIn, mainIn] = entryTimes(c, 't', [side, main], 20);
  expect(mainIn).toBeLessThan(sideIn);
  expect(sideIn).toBeLessThan(20);
});

test('give way: the side arm goes when the main-road car is 5 s out', () => {
  const c = setup(giveWayOnStub);
  const side = c.at(STUB_IN, 1, 3, [E_BACK]);
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
  const side = c.at(STUB_IN, 1, 3, [E_BACK]);
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
  const left = c.at(S_IN, 0.5, 2, [W_OUT]);
  const oncoming = c.at(N_IN, 24, 12, [S_OUT]);
  const [leftIn, oncomingIn] = entryTimes(c, 'cross', [left, oncoming], 15);
  expect(oncomingIn).toBeLessThan(leftIn);
  expect(leftIn).toBeLessThan(15);
});

test('left turn on green goes when the oncoming straight car is 5 s out', () => {
  const c = setup();
  const left = c.at(S_IN, 0.5, 2, [W_OUT]);
  const oncoming = c.at(N_IN, 60, 12, [S_OUT]);
  const [leftIn, oncomingIn] = entryTimes(c, 'cross', [left, oncoming], 15);
  expect(leftIn).toBeLessThan(oncomingIn);
});

test('left turn on green waits for the oncoming player going straight', () => {
  const c = setup();
  const left = c.at(S_IN, 0.5, 2, [W_OUT]);
  const path = c.net.path(N_IN);
  const player = (t: number): PlayerState => {
    const s = Math.min(path.length - 3, path.length - 26 + 12 * t);
    const p = pointAt(path.points, s);
    return { position: p.position, heading: p.heading, speed: s < path.length - 3 ? 12 : 0, length: 4.5, width: 1.8 };
  };
  let entered = Infinity;
  for (let t = 0; t < 1.5; t += DT) {
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
