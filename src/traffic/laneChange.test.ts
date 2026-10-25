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
const W1: LaneRef = { edgeId: 'w', dir: -1, lane: 1 };

function polyLength(pts: Vec2[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

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
            expect(st.s).toBeGreaterThanOrEqual(CLEAR_OF_END);
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

  /** A car behind a slow leader on e lane 0, once its left indicator is on, with the w approach green. */
  function signalling(c: ReturnType<typeof setup>) {
    c.signals.update(27);
    c.sim.place(E0, 45, { carClass: 'nexia', speed: 2.5, factor: 0.15 });
    const id = c.sim.place(E0, 28, { carClass: 'nexia', speed: 4 });
    for (let k = 0; k < 600 && !c.sim.agents[id].indicator; k++) c.step();
    expect(c.sim.agents[id].indicator).toBe('left');
    return id;
  }

  test('a car on a connector into the target lane is a follower: it never has to brake harder than 4 m/s2', () => {
    for (const back of [25, 30, 35]) {
      const c = setup();
      const id = signalling(c);
      const inc = c.sim.place(W1, c.net.path(W1).length - back, { carClass: 'nexia', speed: 16, route: [E1] });
      let prev = c.sim.agents[inc].speed;
      for (let t = 0; t < 8; t += DT) {
        c.step();
        const v = c.sim.agents[inc].speed;
        expect((prev - v) / DT).toBeLessThan(4.2);
        prev = v;
      }
      expect(c.sim.inspect(id)).not.toBeNull();
    }
  });

  test('a player still in the junction behind the target lane counts for the 2 s headway', () => {
    const c = setup();
    const id = signalling(c);
    const run = [...c.net.path(W1).points, ...c.net.connector(W1, E1), ...c.net.path(E1).points];
    const startAt = c.net.path(W1).length + polyLength(c.net.connector(W1, E1));
    const lane1 = c.net.path(E1).points;
    // Timed to be 6 m short of the lane, still in the junction, when the car would start across.
    let u = startAt - SIGNAL_TIME * 22 - 6, prevT: number | null = null;
    for (let t = 0; t < 6; t += DT) {
      u += 22 * DT;
      const p = pointAt(run, u);
      const player: PlayerState = { position: p.position, heading: p.heading, speed: 22, length: 4.5, width: 1.8 };
      c.step(player);
      const ct = c.sim.inspect(id)!.changing;
      if (ct && ct.t >= 0 && !ct.back && (prevT === null || prevT < 0)) {
        const gap = project(lane1, c.sim.agents[id].position) - (u - startAt) - NEXIA / 2 - player.length / 2;
        expect(gap).toBeGreaterThanOrEqual(PLAYER_HEADWAY * player.speed);
      }
      prevT = ct?.t ?? null;
    }
  });

  test('a player closing the gap during the move sends the car back to its lane, indicator on until it is back', () => {
    const c = setup();
    const id = signalling(c);
    const lane0 = c.net.path(E0).points, lane1 = c.net.path(E1).points;
    while ((c.sim.inspect(id)!.changing?.t ?? -1) < 0.3) c.step();
    let back = false, ps = project(lane1, c.sim.agents[id].position) - 20;
    for (let t = 0; t < 6; t += DT) {
      ps += 12 * DT;
      const p = pointAt(lane1, ps);
      c.step({ position: p.position, heading: p.heading, speed: 12, length: 4.5, width: 1.8 });
      const ch = c.sim.inspect(id)!.changing;
      if (ch?.back) back = true;
      if (ch) expect(c.sim.agents[id].indicator).toBe('left');
      if (ps > project(lane1, c.sim.agents[id].position) - 10) break;
    }
    expect(back).toBe(true);
    expect(c.sim.inspect(id)!.ref).toEqual(E0);
    for (let k = 0; k < 120 && c.sim.inspect(id)!.changing; k++) c.step();
    expect(c.sim.inspect(id)!.changing).toBeNull();
    expect(c.sim.agents[id].indicator).toBeNull();
    expect(lateral(lane0, c.sim.agents[id].position)).toBeLessThan(0.05);
  });

  test('a car that stops during the move does not slide sideways', () => {
    const c = setup();
    const id = signalling(c);
    const lane0 = c.net.path(E0).points;
    while ((c.sim.inspect(id)!.changing?.t ?? -1) < 0.3) c.step();
    const ahead = pointAt(lane0, project(lane0, c.sim.agents[id].position) + 9);
    const player: PlayerState = { position: ahead.position, heading: ahead.heading, speed: 0, length: 4.5, width: 1.8 };
    let prev: number | null = null, stopped = 0;
    for (let t = 0; t < 6; t += DT) {
      c.step(player);
      const lat = lateral(lane0, c.sim.agents[id].position);
      if (c.sim.agents[id].speed < 0.01) {
        stopped++;
        if (prev !== null) expect(Math.abs(lat - prev)).toBeLessThan(1e-3);
        prev = lat;
      } else {
        prev = null;
      }
    }
    expect(stopped).toBeGreaterThan(60);
  });
});
