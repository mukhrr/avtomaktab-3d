import type { DistrictData, Vec2 } from '../shared/district';
import { SignalSystem } from '../sim/signals';
import { CHANGE_TIME, CLEAR_OF_END, mobil, PLAYER_HEADWAY, SIGNAL_TIME } from './laneChange';
import { LaneNetwork, pointAt, type LaneRef } from './lanes';
import { testNetwork } from './testNetwork';
import { CAR_CLASSES, TrafficSim, type CrossingOccupancy, type PlayerState } from './trafficSim';
import { project } from './turns';

const DT = 1 / 60;
const NEXIA = CAR_CLASSES.nexia.length;
const AWAY: PlayerState = { position: [100, 60], heading: 0, speed: 0, length: 4.5, width: 1.8 };
const FREE: CrossingOccupancy = { occupied: () => false };

/** Widens e to two lanes each way and w to two lanes into the cross. */
function twoLanes(d: DistrictData): void {
  const e = d.graph.edges.find(x => x.id === 'e')!;
  e.lanesForward = 2;
  e.lanesBackward = 2;
  e.width = 14;
  const w = d.graph.edges.find(x => x.id === 'w')!;
  w.lanesBackward = 2;
  w.width = 10.5;
}

function setup(count = 0, seed = 1) {
  const d = testNetwork();
  twoLanes(d);
  const net = new LaneNetwork(d);
  const signals = new SignalSystem(d);
  const sim = new TrafficSim(d, net, signals, { count, seed });
  const step = (player = AWAY) => {
    signals.update(DT);
    sim.step(DT, player, FREE);
  };
  return { d, net, signals, sim, step };
}

const E0: LaneRef = { edgeId: 'e', dir: 1, lane: 0 };
const E1: LaneRef = { edgeId: 'e', dir: 1, lane: 1 };
const W0: LaneRef = { edgeId: 'w', dir: -1, lane: 0 };

function lateral(points: Vec2[], p: Vec2): number {
  const at = pointAt(points, project(points, p)).position;
  return Math.hypot(at[0] - p[0], at[1] - p[1]);
}

describe('mobil', () => {
  const free = { followerOld: null, followerNew: null, bias: 0 };

  test('changes into a faster free lane', () => {
    expect(mobil({ a: -1.5, aNew: 0.8, ...free })).toBe(true);
  });

  test('stays when the gain is under the threshold', () => {
    expect(mobil({ a: 0.5, aNew: 0.6, ...free })).toBe(false);
  });

  test('stays when the new follower would have to brake harder than 4 m/s2', () => {
    expect(mobil({ a: -1.5, aNew: 1, followerOld: null, followerNew: { a: 0.5, aNew: -4.5 }, bias: 0 })).toBe(false);
  });

  test('politeness weighs the cost to the new follower', () => {
    expect(mobil({ a: 0, aNew: 0.5, followerOld: null, followerNew: { a: 1, aNew: -0.5 }, bias: 0 })).toBe(false);
  });

  test('a turn bias moves a car toward the lane its turn needs, and keeps it from leaving that lane', () => {
    expect(mobil({ a: 0.5, aNew: 0.4, ...free, bias: 0.6 })).toBe(true);
    expect(mobil({ a: 0.5, aNew: 0.9, ...free, bias: -0.6 })).toBe(false);
  });
});

describe('lane changes on a two-lane edge', () => {
  function slowLeader(c: ReturnType<typeof setup>) {
    c.sim.place(E0, 70, { carClass: 'nexia', speed: 5, factor: 0.3 });
    return c.sim.place(E0, 20, { carClass: 'nexia', speed: 14 });
  }

  test('a faster car behind a slow leader shows its left indicator for 2.5 s, then moves into the left lane', () => {
    const c = setup();
    const id = slowLeader(c);
    const lane0 = c.net.path(E0).points;
    let on = -1, moved = -1, done = false;
    for (let t = 0; t < 25 && !done; t += DT) {
      c.step();
      const a = c.sim.agents[id];
      const st = c.sim.inspect(id)!;
      if (st.ref.edgeId === 'e' && st.ref.lane === 1 && !st.changing) {
        expect(a.indicator).toBeNull();
        done = true;
      }
      if (on < 0 && a.indicator) {
        expect(a.indicator).toBe('left');
        on = t;
      }
      if (moved < 0 && lateral(lane0, a.position) > 0.2) moved = t;
    }
    expect(on).toBeGreaterThanOrEqual(0);
    expect(moved - on).toBeGreaterThanOrEqual(SIGNAL_TIME - 2 * DT);
    expect(moved - on).toBeLessThan(SIGNAL_TIME + 0.6);
    expect(done).toBe(true);
    expect(c.sim.laneChanges).toBe(1);
  });

  test('never moves into a gap the player is within 2 s of, and goes once the player has passed', () => {
    const c = setup();
    const id = slowLeader(c);
    const lane1 = c.net.path(E1);
    let ps = 10;
    let starts = 0;
    let prevT: number | null = null;
    let reached = false;
    for (let t = 0; t < 30 && !reached; t += DT) {
      ps += 14 * DT;
      const p = pointAt(lane1.points, ps);
      const player: PlayerState = ps < lane1.length - 20
        ? { position: p.position, heading: p.heading, speed: 14, length: 4.5, width: 1.8 }
        : AWAY;
      c.step(player);
      const st = c.sim.inspect(id)!;
      const ct = st.changing?.t ?? null;
      if (ct !== null && ct >= 0 && (prevT === null || prevT < 0) && player !== AWAY) {
        starts++;
        const mine = project(lane1.points, c.sim.agents[id].position);
        const gap = Math.abs(mine - ps) - NEXIA / 2 - player.length / 2;
        const speed = ps < mine ? player.speed : c.sim.agents[id].speed;
        expect(gap).toBeGreaterThanOrEqual(PLAYER_HEADWAY * speed);
      }
      prevT = ct;
      reached = st.ref.edgeId === 'e' && st.ref.lane === 1;
    }
    expect(starts).toBeLessThanOrEqual(1);
    expect(reached).toBe(true);
  });

  test('a player who drives into the gap while the indicator shows keeps the car in its lane', () => {
    const c = setup();
    const id = slowLeader(c);
    const lane0 = c.net.path(E0).points, lane1 = c.net.path(E1).points;
    let t = 0;
    while (!c.sim.agents[id].indicator && t < 20) {
      c.step();
      t += DT;
    }
    expect(c.sim.agents[id].indicator).toBe('left');
    for (let k = 0; k < (SIGNAL_TIME + 1) / DT; k++) {
      const a = c.sim.agents[id];
      const p = pointAt(lane1, project(lane1, a.position) - 8);
      c.step({ position: p.position, heading: p.heading, speed: a.speed, length: 4.5, width: 1.8 });
      expect(lateral(lane0, c.sim.agents[id].position)).toBeLessThan(0.2);
    }
    expect(c.sim.agents[id].indicator).toBeNull();
    expect(c.sim.inspect(id)!.ref).toEqual(E0);
  });

  test('no change starts within 30 m of a stop line', () => {
    const c = setup();
    const path = c.net.path(W0);
    const line = c.net.pathS(W0, c.d.controllers[0].phases.flat().find(a => a.edgeId === 'w')!.stopAt);
    c.sim.place(W0, line - 40 - NEXIA / 2, { carClass: 'nexia', speed: 3, factor: 0.2 });
    const id = c.sim.place(W0, line - 60 - NEXIA / 2, { carClass: 'nexia', speed: 12 });
    for (let t = 0; t < 15; t += DT) {
      c.step();
      if (c.sim.inspect(id)?.connectorNode !== null) break;
      expect(lateral(path.points, c.sim.agents[id].position)).toBeLessThan(0.2);
      expect(c.sim.inspect(id)!.changing).toBeNull();
    }
  });

  test('in random traffic every change is done clear of lane ends and stop lines, and never on a connector', () => {
    const c = setup(30, 1);
    const prev = new Map<number, { t: number; gen: number }>();
    let starts = 0;
    for (let t = 0; t < 300; t += DT) {
      c.step();
      for (const a of c.sim.agents) {
        const st = c.sim.inspect(a.id);
        if (!st) continue;
        const ch = st.changing;
        const before = prev.get(a.id);
        if (ch) {
          expect(st.connectorNode).toBeNull();
          expect(ch.from.edgeId).toBe(ch.to.edgeId);
          expect(ch.from.dir).toBe(ch.to.dir);
          expect(Math.abs(ch.from.lane - ch.to.lane)).toBe(1);
          if (ch.t >= 0 && before && before.gen === st.generation && before.t < 0) {
            starts++;
            const ref = st.ref;
            const s = st.s;
            const len = c.net.path(ref).length;
            expect(len - s - a.speed * CHANGE_TIME).toBeGreaterThanOrEqual(CLEAR_OF_END - 1);
            const p = c.net.path(ref);
            const light = c.signals.approachState(ref.edgeId, ref.dir, c.net.edgeS(ref, s), [p.startAt, p.endAt]);
            if (light) expect(c.net.pathS(ref, light.stopAt) - s).toBeGreaterThanOrEqual(CLEAR_OF_END);
          }
        }
        prev.set(a.id, { t: ch?.t ?? Infinity, gen: st.generation });
      }
    }
    expect(starts).toBeGreaterThan(0);
    expect(c.sim.laneChanges).toBeGreaterThanOrEqual(starts);
  }, 60_000);
});
