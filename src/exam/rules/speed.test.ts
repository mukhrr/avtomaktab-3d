import { SpeedRule, TailgatingRule } from './speed';
import { drive, ids, repeat } from './testSnap';

const ms = (kmh: number) => kmh / 3.6;

describe('speeding', () => {
  test('12 s at 10 km/h over gives two, at 5 s and 10 s', () => {
    const vs = drive(new SpeedRule(), repeat(120, { speed: ms(70), speedLimit: 60 }));
    expect(ids(vs)).toEqual(['speeding', 'speeding']);
    expect(vs[0].t).toBeCloseTo(4.9, 5);
    expect(vs[1].t).toBeCloseTo(9.9, 5);
  });

  test('a break below the tolerance restarts the 5 s count', () => {
    const over = repeat(45, { speed: ms(70), speedLimit: 60 });
    const under = repeat(5, { speed: ms(64), speedLimit: 60 });
    expect(drive(new SpeedRule(), [...over, ...under, ...over])).toEqual([]);
  });

  test('within the 5 km/h tolerance is never speeding', () => {
    expect(drive(new SpeedRule(), repeat(200, { speed: ms(64.9), speedLimit: 60 }))).toEqual([]);
  });

  test('an unknown limit is not judged', () => {
    expect(drive(new SpeedRule(), repeat(200, { speed: ms(120), speedLimit: 0 }))).toEqual([]);
  });

  test('more than 40 km/h over is severe at once and only once', () => {
    const vs = drive(new SpeedRule(), repeat(120, { speed: ms(101), speedLimit: 60 }));
    expect(ids(vs)).toEqual(['speedingSevere']);
    expect(vs[0].t).toBe(0);
  });

  test('more than 20 km/h over is severe after 3 s and the same stretch is not also charged as speeding', () => {
    const vs = drive(new SpeedRule(), repeat(120, { speed: ms(85), speedLimit: 60 }));
    expect(ids(vs)).toEqual(['speedingSevere']);
    expect(vs[0].t).toBeCloseTo(2.9, 5);
  });

  test('20 km/h over for under 3 s is not severe', () => {
    const vs = drive(new SpeedRule(), [...repeat(29, { speed: ms(85), speedLimit: 60 }), ...repeat(10, { speed: ms(50), speedLimit: 60 })]);
    expect(vs).toEqual([]);
  });

  test('reset clears the running counts', () => {
    const rule = new SpeedRule();
    drive(rule, repeat(45, { speed: ms(70), speedLimit: 60 }));
    rule.reset();
    expect(drive(rule, repeat(45, { speed: ms(70), speedLimit: 60 }), 10)).toEqual([]);
  });
});

describe('tailgating', () => {
  test('under 1 s headway above 20 km/h for 3 s gives one', () => {
    const vs = drive(new TailgatingRule(), repeat(40, { speed: ms(60), leader: { distance: 10, speed: ms(60) } }));
    expect(ids(vs)).toEqual(['tailgating']);
    expect(vs[0].t).toBeCloseTo(2.9, 5);
  });

  test('repeats 10 s after the last one while it continues', () => {
    expect(ids(drive(new TailgatingRule(), repeat(129, { speed: ms(60), leader: { distance: 10, speed: ms(60) } })))).toEqual(['tailgating']);
    expect(ids(drive(new TailgatingRule(), repeat(140, { speed: ms(60), leader: { distance: 10, speed: ms(60) } })))).toEqual(['tailgating', 'tailgating']);
  });

  test('slow queues and safe gaps are fine', () => {
    expect(drive(new TailgatingRule(), repeat(100, { speed: ms(18), leader: { distance: 2, speed: ms(18) } }))).toEqual([]);
    expect(drive(new TailgatingRule(), repeat(100, { speed: ms(60), leader: { distance: 20, speed: ms(60) } }))).toEqual([]);
  });

  test('a gap that opens before 3 s resets the count', () => {
    const close = repeat(25, { speed: ms(60), leader: { distance: 10, speed: ms(60) } });
    const open = repeat(2, { speed: ms(60), leader: null });
    expect(drive(new TailgatingRule(), [...close, ...open, ...close])).toEqual([]);
  });
});
