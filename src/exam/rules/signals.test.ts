import type { LightState } from '../../sim/signals';
import { RuleEngine } from './engine';
import { RedLightRule, StopLinePastRule, YellowEntryRule } from './signals';
import { drive, ids, repeat, snap, type SnapOver } from './testSnap';
import { FRONT_OFFSET } from './thresholds';

const STOP_AT = 100;
const DT = 0.1;

/** Approaching a light on edge `a` (dir 1); the light leaves the snapshot once the centre passes the line. */
const at = (edgeS: number, state: LightState, speed: number): SnapOver => ({
  ref: { edgeId: 'a', dir: 1, lane: 0 },
  match: { edgeS },
  speed,
  signalAhead: edgeS < STOP_AT ? { state, distance: STOP_AT - edgeS, stopAt: STOP_AT } : null,
});

/** Constant speed from `from` for `n` frames, the light given per frame. */
const run = (from: number, speed: number, n: number, state: (i: number) => LightState) =>
  repeat(n, i => at(from + speed * DT * i, state(i), speed));

const stopFrontPast = (past: number, state: LightState, n: number) => repeat(n, at(STOP_AT - FRONT_OFFSET + past, state, 0));

const all = () => [new RedLightRule(), new YellowEntryRule(), new StopLinePastRule()];
const snapAt = (f: SnapOver, i: number) => snap({ ...f, t: i * DT });
const rulesAlone = (frames: SnapOver[]) => all().flatMap(r => drive(r, frames));

describe('redLight', () => {
  test('a red-light run gives exactly one redLight and no stopLinePast', () => {
    const frames = run(60, 10, 80, () => 'red');
    expect(ids(rulesAlone(frames))).toEqual(['redLight']);
    const engine = new RuleEngine(all());
    const vs = frames.flatMap((f, i) => engine.update(snapAt(f, i)));
    expect(ids(vs)).toEqual(['redLight']);
  });

  test('fires when the front, not the centre, is over the line', () => {
    const [v] = drive(new RedLightRule(), run(90, 1, 100, () => 'red'));
    expect(v.id).toBe('redLight');
    const frontPast = (90 + 1 * DT * Math.round(v.t / DT)) - STOP_AT + FRONT_OFFSET;
    expect(frontPast).toBeGreaterThan(0.5);
    expect(frontPast).toBeLessThan(0.7);
    expect(v.detail).toEqual({ line: 'a|1|100' });
  });

  test('redYellow counts as red', () => {
    expect(ids(drive(new RedLightRule(), run(60, 10, 80, () => 'redYellow')))).toEqual(['redLight']);
  });

  test('crossing on green, or stopping with the nose 0.3 m over, is fine', () => {
    expect(rulesAlone(run(60, 10, 80, () => 'green'))).toEqual([]);
    expect(rulesAlone([...run(80, 5, 20, () => 'red').filter(f => f.match!.edgeS! < STOP_AT - FRONT_OFFSET), ...stopFrontPast(0.3, 'red', 30)])).toEqual([]);
  });

  test('stopping past the line on red gives both from the rules and only redLight from the engine', () => {
    const frames = [...run(85, 3, 40, () => 'red').filter(f => f.match!.edgeS! < STOP_AT - FRONT_OFFSET + 1), ...stopFrontPast(1, 'red', 20)];
    expect(ids(rulesAlone(frames)).sort()).toEqual(['redLight', 'stopLinePast']);
    const engine = new RuleEngine(all());
    expect(ids(frames.flatMap((f, i) => engine.update(snapAt(f, i))))).toEqual(['redLight']);
  });
});

describe('yellowEntry', () => {
  // At 10 m/s with the front 30 m short a stop needs 1.7 m/s²; at 14 m/s and 12 m short it needs 8.2 m/s².
  test('entering on yellow when it could have stopped at the onset', () => {
    const onset = 30 + FRONT_OFFSET;
    const frames = [...run(STOP_AT - onset - 10, 10, 10, () => 'green'), ...run(STOP_AT - onset, 10, 40, () => 'yellow')];
    expect(ids(rulesAlone(frames))).toEqual(['yellowEntry']);
  });

  test('yellow when unable to stop gives nothing', () => {
    const onset = 12 + FRONT_OFFSET;
    const frames = [...run(STOP_AT - onset - 14, 14, 10, () => 'green'), ...run(STOP_AT - onset, 14, 30, () => 'yellow')];
    expect(rulesAlone(frames)).toEqual([]);
  });

  test('a light first seen already yellow is judged from that moment', () => {
    expect(ids(drive(new YellowEntryRule(), run(50, 10, 70, () => 'yellow')))).toEqual(['yellowEntry']);
    expect(drive(new YellowEntryRule(), run(STOP_AT - FRONT_OFFSET - 10, 14, 20, () => 'yellow'))).toEqual([]);
  });

  test('yellow that turns red before the line is redLight, not yellowEntry', () => {
    const frames = run(40, 10, 80, i => (i < 10 ? 'green' : i < 40 ? 'yellow' : 'red'));
    expect(ids(rulesAlone(frames))).toEqual(['redLight']);
  });
});

describe('stopLinePast', () => {
  test('crossing on a late yellow and stopping with the front 1.5 m over once it is red', () => {
    const onset = 6 + FRONT_OFFSET;
    const approach = run(STOP_AT - onset - 8, 8, 10, () => 'green');
    const yellow = run(STOP_AT - onset, 8, 10, () => 'yellow').filter(f => f.match!.edgeS! < STOP_AT - FRONT_OFFSET + 1.5);
    const vs = rulesAlone([...approach, ...yellow, ...stopFrontPast(1.5, 'red', 20)]);
    expect(ids(vs)).toEqual(['stopLinePast']);
  });

  test('needs a full second at rest', () => {
    expect(drive(new StopLinePastRule(), stopFrontPast(1, 'red', 9))).toEqual([]);
    expect(ids(drive(new StopLinePastRule(), stopFrontPast(1, 'red', 10)))).toEqual(['stopLinePast']);
  });

  test('only on red, only past 0.5 m, once per line', () => {
    expect(drive(new StopLinePastRule(), stopFrontPast(1, 'green', 30))).toEqual([]);
    expect(drive(new StopLinePastRule(), stopFrontPast(0.4, 'red', 30))).toEqual([]);
    expect(ids(drive(new StopLinePastRule(), stopFrontPast(1, 'red', 60)))).toEqual(['stopLinePast']);
  });
});
