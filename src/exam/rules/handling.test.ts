import { HarshBrakingRule, RollBackRule, StallRule } from './handling';
import { drive, ids, repeat, type SnapOver } from './testSnap';

describe('harshBraking', () => {
  /** Cruise at 12 m/s, then brake at `decel` for `n` frames; `extra` applies to the braking frames. */
  const brake = (decel: number, n: number, extra: SnapOver = {}): SnapOver[] => [
    ...repeat(5, { speed: 12 }),
    ...repeat(n, i => ({ speed: 12 - decel * 0.1 * (i + 1), accel: -decel, ...extra })),
    ...repeat(5, { speed: 12 - decel * 0.1 * n }),
  ];

  test('over 6 m/s² for 0.3 s with nothing ahead gives one', () => {
    const vs = drive(new HarshBrakingRule(), brake(7, 4));
    expect(ids(vs)).toEqual(['harshBraking']);
    expect(vs[0].t).toBeCloseTo(0.7, 5);
  });

  test('0.2 s, or 5 m/s², gives none', () => {
    expect(drive(new HarshBrakingRule(), brake(7, 2))).toEqual([]);
    expect(drive(new HarshBrakingRule(), brake(5, 10))).toEqual([]);
  });

  test('a red or yellow light, a pedestrian at a crossing, or a leader inside the stopping distance excuses it', () => {
    const ahead = (distance: number, over = {}) =>
      ({ crossingsAhead: [{ id: 'z', distance, occupied: false, kind: 'zebra' as const, pedOnCarriageway: false, pedAtCurb: false, ...over }] });
    expect(drive(new HarshBrakingRule(), brake(7, 4, { signalAhead: { state: 'red', distance: 20, stopAt: 0 } }))).toEqual([]);
    expect(drive(new HarshBrakingRule(), brake(7, 4, { signalAhead: { state: 'yellow', distance: 20, stopAt: 0 } }))).toEqual([]);
    expect(drive(new HarshBrakingRule(), brake(7, 4, ahead(15, { pedOnCarriageway: true, occupied: true })))).toEqual([]);
    expect(drive(new HarshBrakingRule(), brake(7, 4, ahead(15, { pedAtCurb: true })))).toEqual([]);
    expect(drive(new HarshBrakingRule(), brake(7, 4, { leader: { distance: 10, speed: 0 } }))).toEqual([]);
  });

  test('a green light, an empty crossing or a far leader is no reason', () => {
    expect(ids(drive(new HarshBrakingRule(), brake(7, 4, { signalAhead: { state: 'green', distance: 20, stopAt: 0 } })))).toEqual(['harshBraking']);
    expect(ids(drive(new HarshBrakingRule(), brake(7, 4, { leader: { distance: 40, speed: 10 } })))).toEqual(['harshBraking']);
  });

  test('a crash is not also harsh braking (RF2)', () => {
    const frames = brake(30, 4).map((f, i) => (i === 5 ? { ...f, events: [{ type: 'collision' as const, with: 'car' as const, speed: 8, time: 0 }] } : f));
    expect(drive(new HarshBrakingRule(), frames)).toEqual([]);
  });

  test('once per 10 s', () => {
    const twice = (gap: number) => [...brake(7, 4), ...repeat(gap, { speed: 9 }), ...brake(7, 4)];
    expect(ids(drive(new HarshBrakingRule(), twice(40)))).toEqual(['harshBraking']);
    expect(ids(drive(new HarshBrakingRule(), twice(100)))).toEqual(['harshBraking', 'harshBraking']);
  });

  test('braking while reversing is not judged', () => {
    expect(drive(new HarshBrakingRule(), repeat(10, { speed: -3, accel: 8 }))).toEqual([]);
    expect(drive(new HarshBrakingRule(), repeat(10, { speed: -3, accel: -8 }))).toEqual([]);
  });
});

describe('stall', () => {
  test('the engine dying on a manual gives one per stall', () => {
    const frames: SnapOver[] = [...repeat(5, { running: true }), ...repeat(5, { running: false }), ...repeat(5, { running: true }), ...repeat(5, { running: false })];
    expect(ids(drive(new StallRule(), frames))).toEqual(['stall', 'stall']);
  });

  test('an engine already off at the start, or an automatic, gives none', () => {
    expect(drive(new StallRule(), [...repeat(5, { running: false }), ...repeat(5, { running: true })])).toEqual([]);
    expect(drive(new StallRule(), [...repeat(5, { running: true, gearbox: 'auto' }), ...repeat(5, { running: false, gearbox: 'auto' })])).toEqual([]);
  });
});

describe('rollBack', () => {
  test('rolling back more than 0.5 m in first gear gives one per roll', () => {
    const vs = drive(new RollBackRule(), [...repeat(5, { speed: 0 }), ...repeat(15, { speed: -0.5, gear: 1 })]);
    expect(ids(vs)).toEqual(['rollBack']);
    expect(vs[0].t).toBeCloseTo(1.5, 5);
  });

  test('0.4 m, or slower than 0.3 m/s, gives none', () => {
    expect(drive(new RollBackRule(), repeat(8, { speed: -0.5, gear: 1 }))).toEqual([]);
    expect(drive(new RollBackRule(), repeat(40, { speed: -0.25, gear: 1 }))).toEqual([]);
  });

  test('in reverse or neutral it is not a roll back; in D it is', () => {
    expect(drive(new RollBackRule(), repeat(30, { speed: -2, gear: -1 }))).toEqual([]);
    expect(drive(new RollBackRule(), repeat(30, { speed: -0.5, gear: 0 }))).toEqual([]);
    expect(ids(drive(new RollBackRule(), repeat(30, { speed: -0.5, gear: 1, gearbox: 'auto' })))).toEqual(['rollBack']);
  });

  test('stopping between two rolls makes them two', () => {
    const roll = repeat(15, { speed: -0.5, gear: 1 });
    expect(ids(drive(new RollBackRule(), [...roll, ...repeat(5, { speed: 0 }), ...roll]))).toEqual(['rollBack', 'rollBack']);
    expect(ids(drive(new RollBackRule(), repeat(60, { speed: -0.5, gear: 1 })))).toEqual(['rollBack']);
  });
});
