import { LaneNetwork, pointAt, type LaneRef } from '../traffic/lanes';
import { testNetwork } from '../traffic/testNetwork';
import { Examiner, type Prompt } from './examiner';
import { loadPenalties, type PenaltyId } from './penalties';
import { RuleEngine } from './rules/engine';
import type { Violation } from './rules/types';
import { snap, DT, type SnapOver } from './rules/testSnap';
import { planRoute, type ExamRoute } from './route';

const penalties = loadPenalties();
const lane = (edgeId: string, dir: 1 | -1): LaneRef => ({ edgeId, dir, lane: 0 });
const W_IN = lane('w', -1), N_OUT = lane('n', 1), N_BACK = lane('n', -1), W_OUT = lane('w', 1), E_OUT = lane('e', 1);

const viol = (id: PenaltyId, t: number): Violation => ({ id, t, position: [0, 0] });

/** Drives an Examiner through scripted lane runs, collecting every prompt it speaks. */
class Run {
  d = testNetwork();
  net = new LaneNetwork(this.d);
  t = 0;
  prompts: Prompt[] = [];
  ex: Examiner;
  constructor(public route: ExamRoute, engine?: Pick<RuleEngine, 'flush'>, planner?: typeof planRoute) {
    this.ex = new Examiner(route, this.net, penalties, this.d, engine, planner);
    this.ex.update(snap({ t: 0 }), []);
    this.ex.start();
    this.prompts.push(...this.ex.update(snap({ t: 0, ref: null }), []));
    this.t = DT;
  }

  frame(ref: LaneRef | null, pathS: number, extra: SnapOver = {}, v: Violation[] = []): Prompt[] {
    const p = ref ? pointAt(this.net.path(ref).points, pathS).position : [0, 0] as [number, number];
    const edgeS = ref ? this.net.edgeS(ref, pathS) : 0;
    const out = this.ex.update(snap({ t: this.t, position: p, speed: 5, ref, match: { edgeS }, ...extra }), v);
    this.t += DT;
    this.prompts.push(...out);
    return out;
  }

  /** From pathS `a` to `b` on a lane at 5 m/s. */
  lane(ref: LaneRef, a: number, b = this.net.path(ref).length, extra: SnapOver = {}): void {
    for (let s = a; s <= b + 1e-9; s += 0.5) this.frame(ref, s, extra);
  }

  junction(from: LaneRef, to: LaneRef): void {
    const c = this.net.connector(from, to);
    for (const p of c) {
      this.ex.update(snap({ t: this.t, position: p, speed: 5, ref: from, match: { inJunction: 'cross', onConnector: true } }), []);
      this.t += DT;
    }
  }

  stopFor(ref: LaneRef, pathS: number, seconds: number): void {
    for (let i = 0; i < Math.round(seconds / DT) + 1; i++) this.frame(ref, pathS, { speed: 0 });
  }

  get keys(): string[] {
    return this.prompts.map(p => p.key);
  }
}

const plan = (wps: [number, number][]) => {
  const d = testNetwork();
  return planRoute(new LaneNetwork(d), d, wps);
};
const leftRoute = () => plan([[-100, 3], [3, -100]]);

describe('briefing', () => {
  it('speaks the brief once, then waits for start()', () => {
    const d = testNetwork();
    const ex = new Examiner(leftRoute(), new LaneNetwork(d), penalties, d);
    expect(ex.phase).toBe('briefing');
    expect(ex.update(snap(), []).map(p => p.key)).toEqual(['exam.brief']);
    expect(ex.update(snap({ t: 0.1 }), [])).toEqual([]);
    expect(ex.nextManeuver).toBeNull();
    ex.start();
    expect(ex.phase).toBe('driving');
    expect(ex.update(snap({ t: 0.2 }), []).map(p => p.key)).toEqual(['exam.start']);
  });
});

describe('directions', () => {
  it('announces a left turn at 50 m and 15 m even though step 0 is the start step', () => {
    const r = new Run(leftRoute());
    expect(r.route.steps[0].maneuver).toBe('start');
    const len = r.net.path(W_IN).length;
    r.lane(W_IN, 20, len);
    const keys = r.keys.filter(k => k.startsWith('exam.turn'));
    expect(keys).toEqual(['exam.turnLeftAhead', 'exam.turnLeftNow']);
    const junctions = r.prompts.filter(p => p.key.startsWith('exam.turn')).map(p => p.vars?.junction);
    expect(junctions[0]).toBeDefined();
    expect(junctions[1]).toBe(junctions[0]);
  });

  it('fires "ahead" within a metre of 50 m from the junction and "now" at 15 m', () => {
    const r = new Run(leftRoute());
    const len = r.net.path(W_IN).length;
    let aheadAt = -1, nowAt = -1;
    for (let s = 20; s <= len; s += 0.5) {
      const out = r.frame(W_IN, s);
      if (out.some(p => p.key === 'exam.turnLeftAhead')) aheadAt = len - s;
      if (out.some(p => p.key === 'exam.turnLeftNow')) nowAt = len - s;
    }
    expect(aheadAt).toBeLessThanOrEqual(50);
    expect(aheadAt).toBeGreaterThan(49);
    expect(nowAt).toBeLessThanOrEqual(15);
    expect(nowAt).toBeGreaterThan(14);
  });

  it('reports the next maneuver and its distance', () => {
    const r = new Run(leftRoute());
    r.frame(W_IN, 20);
    const n = r.ex.nextManeuver!;
    expect(n.maneuver).toBe('left');
    expect(n.distance).toBeCloseTo(r.net.path(W_IN).length - 20, 1);
  });

  it('announces a step that begins closer than 50 m at once', () => {
    const r = new Run(leftRoute());
    r.frame(W_IN, r.net.path(W_IN).length - 30);
    expect(r.keys).toContain('exam.turnLeftAhead');
  });

  it('says straight only at a signalled junction where turning is possible', () => {
    const route = plan([[-100, 3], [120, 3], [237, 30]]);
    const signalled = new Run(route);
    signalled.lane(W_IN, 20, signalled.net.path(W_IN).length, { signalAhead: { state: 'green', distance: 30, stopAt: 5 } });
    expect(signalled.keys).toContain('exam.straight');
    const plain = new Run(route);
    plain.lane(W_IN, 20, plain.net.path(W_IN).length);
    expect(plain.keys).not.toContain('exam.straight');
  });

  it('never refers to a junction already passed', () => {
    const r = new Run(leftRoute());
    const len = r.net.path(W_IN).length;
    r.lane(W_IN, 20, len);
    r.junction(W_IN, N_OUT);
    const before = r.prompts.length;
    r.lane(N_OUT, 0, 40);
    // Only the finish is left: no turn prompt may follow the junction.
    expect(r.prompts.slice(before).map(p => p.key).filter(k => k.startsWith('exam.turn') || k === 'exam.straight')).toEqual([]);
    expect(r.ex.nextManeuver!.maneuver).toBe('finish');
  });

  it('does not announce a turn first seen after the lane end', () => {
    const r = new Run(leftRoute());
    r.frame(W_IN, r.net.path(W_IN).length + 1);
    expect(r.keys.filter(k => k.startsWith('exam.turn'))).toEqual([]);
  });
});

describe('progress', () => {
  it('gives each route step its own junction id on direction prompts', () => {
    const r = new Run(plan([[-100, 3], [3, -100], [-100, 3], [120, 3]]));
    r.lane(W_IN, 20);
    r.junction(W_IN, N_OUT);
    r.lane(N_OUT, 0);
    r.junction(N_OUT, N_BACK);
    r.lane(N_BACK, 0);
    r.junction(N_BACK, W_OUT);
    r.lane(W_OUT, 0);
    const dir = r.prompts.filter(p => p.key !== 'exam.brief' && p.key !== 'exam.start');
    const ids = dir.map(p => `${p.key}@${p.vars?.junction}`);
    expect(new Set(dir.map(p => p.vars?.junction)).size).toBeGreaterThanOrEqual(3);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('follows a route that revisits a lane forward only', () => {
    // w eastbound twice: out to the n arm, west to the dead end of w and back, then straight on to e.
    const route = plan([[-100, 3], [3, -100], [-100, 3], [120, 3]]);
    expect(route.steps.map(s => `${s.ref.edgeId}${s.ref.dir}`)).toEqual(['w-1', 'n1', 'n-1', 'w1', 'w-1', 'e1']);
    const r = new Run(route);
    r.lane(W_IN, 20);
    r.junction(W_IN, N_OUT);
    r.lane(N_OUT, 0);
    r.junction(N_OUT, N_BACK);
    expect(r.ex.nextManeuver!.maneuver).toBe('uturn');
    r.lane(N_BACK, 0, 10);
    expect(r.ex.nextManeuver!.maneuver).toBe('right');
    r.lane(N_BACK, 10);
    r.junction(N_BACK, W_OUT);
    r.lane(W_OUT, 0, 10);
    expect(r.ex.nextManeuver!.maneuver).toBe('uturn');
    r.lane(W_OUT, 10);
    r.junction(W_OUT, W_IN);
    r.lane(W_IN, 0, 30);
    // Back on w, but step 3: the maneuver is the straight on into e, not step 0's turn.
    expect(r.ex.nextManeuver!.maneuver).toBe('straight');
    expect(r.keys.filter(k => k === 'exam.reroute')).toEqual([]);
    r.lane(W_IN, 30);
    r.junction(W_IN, E_OUT);
    r.lane(E_OUT, 0, 30);
    expect(r.ex.nextManeuver!.maneuver).toBe('finish');
  });
});

describe('rerouting', () => {
  it('re-plans once without penalty after a missed turn and still reaches the finish', () => {
    const route = plan([[-100, 3], [120, 3], [237, 30]]);
    const r = new Run(route);
    r.lane(W_IN, 20);
    r.junction(W_IN, N_OUT);
    // The route went straight on into e; the player took the n arm.
    r.lane(N_OUT, 0, 40);
    expect(r.keys.filter(k => k === 'exam.reroute')).toHaveLength(1);
    expect(r.ex.result.total).toBe(0);
    expect(r.ex.phase).toBe('driving');
    // Out of the dead end, back through the cross, east along e, right into the stub.
    expect(r.ex.nextManeuver!.maneuver).toBe('uturn');
    r.lane(N_OUT, 40);
    r.junction(N_OUT, N_BACK);
    r.lane(N_BACK, 0);
    r.junction(N_BACK, E_OUT);
    r.lane(E_OUT, 0);
    r.junction(E_OUT, lane('tStub', 1));
    const stub = lane('tStub', 1);
    r.lane(stub, 0, 30);
    r.stopFor(stub, 30, 3);
    expect(r.ex.phase).toBe('finished');
    expect(r.keys.filter(k => k === 'exam.reroute')).toHaveLength(1);
  });

  it('retries a failed replan from the same lane and still finishes', () => {
    const route = plan([[-100, 3], [120, 3], [237, 30]]);
    let calls = 0;
    const planner: typeof planRoute = (...a) => {
      if (calls++ === 0) throw new Error('no route');
      return planRoute(...a);
    };
    const r = new Run(route, undefined, planner);
    r.lane(W_IN, 20);
    r.junction(W_IN, N_OUT);
    r.lane(N_OUT, 0, 15);
    expect(r.keys).not.toContain('exam.reroute');
    r.lane(N_OUT, 15, 60);
    expect(r.keys.filter(k => k === 'exam.reroute')).toHaveLength(1);
    r.lane(N_OUT, 60);
    r.junction(N_OUT, N_BACK);
    r.lane(N_BACK, 0);
    r.junction(N_BACK, E_OUT);
    r.lane(E_OUT, 0);
    r.junction(E_OUT, lane('tStub', 1));
    r.lane(lane('tStub', 1), 0, 30);
    r.stopFor(lane('tStub', 1), 30, 3);
    expect(r.ex.phase).toBe('finished');
  });

  it('ignores a brief wrong-lane flicker', () => {
    const r = new Run(plan([[-100, 3], [120, 3], [237, 30]]));
    r.lane(W_IN, 20, 60);
    r.frame(N_OUT, 5);
    r.frame(N_OUT, 5.5);
    r.lane(W_IN, 61, 70);
    expect(r.keys).not.toContain('exam.reroute');
  });
});

describe('finishing', () => {
  const finishRun = () => {
    const r = new Run(leftRoute());
    r.lane(W_IN, 20);
    r.junction(W_IN, N_OUT);
    return r;
  };
  const FINISH_S = 95.5;

  it('finishes and passes after 2 s at rest near the end of the route', () => {
    const r = finishRun();
    r.lane(N_OUT, 0, FINISH_S - 0.5);
    expect(r.ex.phase).toBe('driving');
    r.stopFor(N_OUT, FINISH_S, 1);
    expect(r.ex.phase).toBe('driving');
    r.stopFor(N_OUT, FINISH_S, 1.5);
    expect(r.ex.phase).toBe('finished');
    expect(r.ex.result).toMatchObject({ phase: 'finished', passed: true, total: 0, routeId: r.route.id });
    expect(r.keys.at(-1)).toBe('exam.passed');
    expect(r.keys).toContain('exam.finishAhead');
    expect(r.keys).toContain('exam.stopHere');
  });

  it('does not finish when the car is still moving or far from the end', () => {
    const r = finishRun();
    r.lane(N_OUT, 0, FINISH_S);
    for (let i = 0; i < 40; i++) r.frame(N_OUT, FINISH_S, { speed: 0.8 });
    expect(r.ex.phase).toBe('driving');
    const far = finishRun();
    far.stopFor(N_OUT, 20, 4);
    expect(far.ex.phase).toBe('driving');
  });

  it('reports duration and distance driven', () => {
    const r = finishRun();
    r.lane(N_OUT, 0, FINISH_S);
    r.stopFor(N_OUT, FINISH_S, 2.5);
    const res = r.ex.result;
    expect(res.durationS).toBeGreaterThan(10);
    expect(res.distanceM).toBeGreaterThan(100);
  });
});

describe('scoring', () => {
  it('fails at once on a fail-tier violation', () => {
    const r = new Run(leftRoute());
    r.lane(W_IN, 20, 30);
    const out = r.frame(W_IN, 31, {}, [viol('redLight', r.t)]);
    expect(r.ex.phase).toBe('failed');
    expect(out.map(p => p.key)).toEqual(['exam.violation', 'exam.failed']);
    expect(r.ex.result).toMatchObject({ phase: 'failed', passed: false, total: 100 });
    expect(r.ex.update(snap({ t: r.t }), [])).toEqual([]);
  });

  it('fails at 100 points from five high violations, not at 80', () => {
    const r = new Run(leftRoute());
    for (let i = 0; i < 4; i++) r.frame(W_IN, 20 + i, {}, [viol('noIndicator', r.t)]);
    expect(r.ex.phase).toBe('driving');
    expect(r.ex.result.total).toBe(80);
    r.frame(W_IN, 25, {}, [viol('noIndicator', r.t)]);
    expect(r.ex.phase).toBe('failed');
    expect(r.ex.result.total).toBe(100);
    expect(r.keys.at(-1)).toBe('exam.failed');
  });

  const finishAfter = (r: Run) => {
    r.lane(W_IN, 24);
    r.junction(W_IN, N_OUT);
    r.lane(N_OUT, 0, 95);
    r.stopFor(N_OUT, 95.5, 2.5);
  };

  it('passes with a few low penalties over the drive', () => {
    const r = new Run(leftRoute());
    r.lane(W_IN, 20, 23);
    for (const id of ['speeding', 'harshBraking', 'tailgating'] as PenaltyId[]) r.frame(W_IN, 23, {}, [viol(id, r.t)]);
    expect(r.ex.result.total).toBe(15);
    finishAfter(r);
    expect(r.ex.result).toMatchObject({ phase: 'finished', passed: true, total: 15 });
  });

  it('still passes on 95 points, the most under the limit', () => {
    const r = new Run(leftRoute());
    r.lane(W_IN, 20, 23);
    for (let i = 0; i < 4; i++) r.frame(W_IN, 23, {}, [viol('noIndicator', r.t)]);
    for (const id of ['speeding', 'harshBraking', 'tailgating'] as PenaltyId[]) r.frame(W_IN, 23, {}, [viol(id, r.t)]);
    expect(r.ex.result.total).toBe(95);
    finishAfter(r);
    expect(r.ex.result).toMatchObject({ phase: 'finished', passed: true, total: 95 });
  });

  it('makes only high and fail penalties spoken', () => {
    const r = new Run(leftRoute());
    const low = r.frame(W_IN, 20, {}, [viol('harshBraking', r.t)]);
    const high = r.frame(W_IN, 21, {}, [viol('noIndicator', r.t)]);
    expect(low[0]).toMatchObject({ key: 'exam.violation', vars: { id: 'harshBraking', points: 5, spoken: 0 } });
    expect(high[0]).toMatchObject({ key: 'exam.violation', vars: { id: 'noIndicator', points: 20, spoken: 1 } });
  });

  it('keeps held engine violations from before the end and sorts by time', () => {
    const held = [viol('stopLinePast', 0.5), viol('yellowEntry', 99)];
    const r = new Run(leftRoute(), { flush: () => held });
    r.lane(W_IN, 20, 30);
    r.frame(W_IN, 31, {}, [viol('speeding', r.t)]);
    r.ex.abandon();
    const res = r.ex.result;
    expect(res.violations.map(v => v.id)).toEqual(['stopLinePast', 'speeding']);
    expect(res.total).toBe(25);
  });

  it('flushed violations can turn a finish into a fail', () => {
    const held = [viol('yellowEntry', 1)];
    const r = new Run(leftRoute(), { flush: () => held });
    for (let i = 0; i < 4; i++) r.frame(W_IN, 20 + i, {}, [viol('noIndicator', 0.1 * i)]);
    r.lane(W_IN, 24);
    r.junction(W_IN, N_OUT);
    r.lane(N_OUT, 0, 95);
    r.stopFor(N_OUT, 95.5, 2.5);
    expect(r.ex.phase).toBe('failed');
    expect(r.ex.result.passed).toBe(false);
  });
});

describe('abandoning', () => {
  it('abandon() ends the exam without a pass', () => {
    const r = new Run(leftRoute());
    r.lane(W_IN, 20, 40);
    r.ex.abandon();
    expect(r.ex.result).toMatchObject({ phase: 'abandoned', passed: false });
    expect(r.ex.update(snap({ t: 9 }), [])).toEqual([]);
  });

  it('leaving the district abandons', () => {
    const r = new Run(leftRoute());
    r.lane(W_IN, 20, 30);
    r.frame(null, 0, { position: [900, 0] });
    expect(r.ex.phase).toBe('abandoned');
  });
});
