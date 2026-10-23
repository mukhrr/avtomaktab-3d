import type { Vec2 } from '../../shared/district';
import { SignalSystem } from '../../sim/signals';
import { SignSystem } from '../../sim/signs';
import { LaneNetwork } from '../../traffic/lanes';
import { testNetwork } from '../../traffic/testNetwork';
import { TrafficSim } from '../../traffic/trafficSim';
import { newCabin, type CabinState } from '../../vehicle/cabin';
import type { DrivetrainState } from '../../vehicle/drivetrain';
import { MapMatcher } from '../mapMatch';
import { buildSnapshot, type DriveSnapshot, type SnapshotContext } from '../snapshot';
import { CollisionRule } from './collisions';
import { RuleEngine } from './engine';
import { HarshBrakingRule } from './handling';
import { WrongLaneForTurnRule } from './lanes';
import { RoadInfo } from './road';
import { IndicatorRule, MirrorCheckRule, SeatBeltRule } from './signalling';
import { RedLightRule, StopLinePastRule, YellowEntryRule } from './signals';
import { NoEntryRule, StopSignRule, TurnRestrictionRule, WrongWayOnewayRule } from './signs';
import { SpeedRule, TailgatingRule } from './speed';
import { snap } from './testSnap';
import type { Rule, Violation } from './types';

/** Emits the scripted violations at their times. */
function scripted(vs: Violation[]): Rule & { resets: number } {
  return {
    id: 'scripted',
    resets: 0,
    update: (s: DriveSnapshot) => vs.filter(v => Math.abs(v.t - s.t) < 1e-9),
    reset() { this.resets++; },
  };
}

const v = (id: Violation['id'], t: number, detail?: Violation['detail']): Violation => ({ id, t, position: [0, 0], ...(detail ? { detail } : {}) });
const runTo = (engine: RuleEngine, until: number) => {
  const out: Violation[] = [];
  for (let i = 0; i <= until * 10; i++) out.push(...engine.update(snap({ t: i / 10 })));
  return out;
};

test('passes violations through in rule order', () => {
  const engine = new RuleEngine([scripted([v('speeding', 1)]), scripted([v('noSeatBelt', 1), v('tailgating', 2)])]);
  expect(runTo(engine, 3).map(x => x.id)).toEqual(['speeding', 'noSeatBelt', 'tailgating']);
});

test('redLight hides stopLinePast and yellowEntry from the same line within 3 s', () => {
  const line = { line: 'a|1|100' };
  const other = { line: 'b|1|50' };
  const engine = new RuleEngine([
    scripted([v('redLight', 1, line)]),
    scripted([v('stopLinePast', 2.5, line), v('yellowEntry', 1, line), v('stopLinePast', 3, other), v('stopLinePast', 4.2, line)]),
  ]);
  expect(runTo(engine, 8).map(x => `${x.id}@${x.t}`)).toEqual(['redLight@1', 'stopLinePast@3', 'stopLinePast@4.2']);
});

test('pedestrianNotYielded hides the collisionPedestrian that follows within 3 s, vehicleNotYielded the collisionCar', () => {
  const engine = new RuleEngine([scripted([
    v('pedestrianNotYielded', 1, { crossing: 'z1' }), v('collisionPedestrian', 1.5, { ped: 3 }), v('collisionPedestrian', 4.5, { ped: 4 }),
    v('vehicleNotYielded', 6, { agent: 7 }), v('collisionCar', 7, { speed: 6 }),
  ])]);
  expect(runTo(engine, 10).map(x => `${x.id}@${x.t}`)).toEqual(['pedestrianNotYielded@1', 'collisionPedestrian@4.5', 'vehicleNotYielded@6']);
});

test('a crash through the real rules is one collisionCar, not also harsh braking (RF2)', () => {
  const engine = new RuleEngine([new CollisionRule(), new HarshBrakingRule()]);
  const crash = { type: 'collision' as const, with: 'car' as const, speed: 9, time: 0 };
  const out: Violation[] = [];
  for (let i = 0; i < 30; i++) {
    const speed = i < 10 ? 9 : Math.max(0, 9 - (i - 9) * 3);
    const events = i === 10 || i === 11 || i === 14 ? [crash] : [];
    out.push(...engine.update(snap({ t: i / 10, speed, accel: i >= 10 && speed > 0 ? -30 : 0, events })));
  }
  expect(out.map(x => x.id)).toEqual(['collisionCar']);
});

test('a lower-tier same-line violation is held back 3 s, so a later redLight still hides it', () => {
  const line = { line: 'a|1|100' };
  const engine = new RuleEngine([scripted([v('stopLinePast', 1, line), v('redLight', 3.5, line)])]);
  const out: string[] = [];
  for (let i = 0; i <= 80; i++) out.push(...engine.update(snap({ t: i / 10 })).map(x => `${x.id}@${x.t}`));
  expect(out).toEqual(['redLight@3.5']);
});

test('a held violation is released, with its own time and place, once 3 s pass without a redLight', () => {
  const engine = new RuleEngine([scripted([{ ...v('stopLinePast', 1, { line: 'x' }), position: [5, 6] }])]);
  const seen: [number, Violation][] = [];
  for (let i = 0; i <= 50; i++) for (const x of engine.update(snap({ t: i / 10 }))) seen.push([i / 10, x]);
  expect(seen).toHaveLength(1);
  expect(seen[0][0]).toBeCloseTo(4.1, 5);
  expect(seen[0][1]).toMatchObject({ id: 'stopLinePast', t: 1, position: [5, 6] });
});

test('flush returns what is still held, once', () => {
  const engine = new RuleEngine([scripted([v('yellowEntry', 1, { line: 'x' })])]);
  expect(runTo(engine, 2)).toEqual([]);
  expect(engine.flush().map(x => x.id)).toEqual(['yellowEntry']);
  expect(engine.flush()).toEqual([]);
});

test('a suppressor later in the same step still hides an earlier rule', () => {
  const line = { line: 'a|1|100' };
  const engine = new RuleEngine([scripted([v('stopLinePast', 1, line)]), scripted([v('redLight', 1, line)])]);
  expect(runTo(engine, 6).map(x => x.id)).toEqual(['redLight']);
});

test('noEntry hides wrongWayOneway on the same edge and direction', () => {
  const edge = { edge: 'o1|-1' };
  const engine = new RuleEngine([scripted([v('noEntry', 1, edge), v('wrongWayOneway', 2.5, edge), v('wrongWayOneway', 3, { edge: 'o2|-1' })])]);
  expect(runTo(engine, 4).map(x => `${x.id}@${x.t}`)).toEqual(['noEntry@1', 'wrongWayOneway@3']);
});

test('reset resets every rule and forgets suppressors', () => {
  const a = scripted([v('redLight', 1, { line: 'x' })]);
  const b = scripted([v('stopLinePast', 1.5, { line: 'x' })]);
  const engine = new RuleEngine([a, b]);
  runTo(engine, 1);
  engine.reset();
  expect(a.resets).toBe(1);
  expect(b.resets).toBe(1);
  engine.update(snap({ t: 1.5 }));
  expect(engine.flush().map(x => x.id)).toEqual(['stopLinePast']);
});

describe('end to end through the real matcher and snapshot', () => {
  const DT30 = 1 / 30;
  const EAST = Math.PI / 2;

  /** Eastbound on w, left at the cross onto n northbound, at 5 m/s. */
  function leftTurnPath(): { position: Vec2; heading: number }[] {
    const out: { position: Vec2; heading: number }[] = [];
    const step = 5 * DT30, R = 7.75, cx = -6, cz = 1.75 - R;
    for (let x = -80; x < cx; x += step) out.push({ position: [x, 1.75], heading: EAST });
    for (let a = 0; a < Math.PI / 2; a += step / R) out.push({ position: [cx + R * Math.sin(a), cz + R * Math.cos(a)], heading: EAST + a });
    for (let z = -6; z > -60; z -= step) out.push({ position: [1.75, z], heading: Math.PI });
    return out;
  }

  function run(redLight: boolean, cabinAt: (t: number) => Partial<CabinState>) {
    const d = testNetwork();
    const net = new LaneNetwork(d);
    const signals = new SignalSystem(d);
    const signs = new SignSystem(d);
    signals.time = redLight ? 0 : 27;
    const traffic = new TrafficSim(d, net, signals, { count: 0, seed: 1 }, signs);
    const ctx: SnapshotContext = { d, net, matcher: new MapMatcher(d, net), signals, signs, peds: { occupied: () => false, curbWaiting: () => false }, traffic, playerLength: 4.5 };
    const road = new RoadInfo(d, net, signs);
    const engine = new RuleEngine([
      new RedLightRule(), new YellowEntryRule(), new StopLinePastRule(), new StopSignRule(road), new NoEntryRule(road),
      new TurnRestrictionRule(road), new WrongWayOnewayRule(road), new SpeedRule(), new TailgatingRule(),
      new IndicatorRule(road), new MirrorCheckRule(road), new SeatBeltRule(), new WrongLaneForTurnRule(road),
    ]);
    const drivetrain: DrivetrainState = { gearbox: 'manual', gear: 2, rpm: 2500, running: true };
    return leftTurnPath().flatMap((p, i) => {
      const t = i * DT30;
      const cabin = { ...newCabin(), belt: true, ...cabinAt(t) };
      return engine.update(buildSnapshot(ctx, { t, dt: DT30, ...p, speed: 5, prevSpeed: 5, drivetrain, cabin, steer: 0, events: [] }));
    });
  }

  test('an unsignalled, unchecked left turn on green gives noIndicator and noMirrorCheck once each', () => {
    expect(run(false, () => ({})).map(x => x.id).sort()).toEqual(['noIndicator', 'noMirrorCheck']);
  });

  test('the same turn done properly gives nothing', () => {
    expect(run(false, t => ({ indicator: 'left', lastGlance: { left: t > 12 ? 12 : -Infinity, rear: -Infinity, right: -Infinity } }))).toEqual([]);
  });

  test('on red it is one redLight on top', () => {
    const vs = run(true, t => ({ indicator: 'left', lastGlance: { left: t > 12 ? 12 : -Infinity, rear: -Infinity, right: -Infinity } }));
    expect(vs.map(x => x.id)).toEqual(['redLight']);
  });
});
