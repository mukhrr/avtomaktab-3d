import { NoEntryRule, StopSignRule, TurnRestrictionRule, WrongWayOnewayRule } from './signs';
import { E_OUT, N_OUT, S_OUT, W_BACK, W_IN, testRoad, transit } from './testRoad';
import { drive, fresh, ids, repeat, type SnapOver } from './testSnap';
import { FRONT_OFFSET } from './thresholds';
import { CODE } from '../../shared/signCatalogue';

describe('noFullStopAtStopSign', () => {
  const road = testRoad([{ code: CODE.stop, edgeId: 'w', dir: -1, at: 8 }]);
  const line = road.laneEnd(W_IN);
  /** Frame with the front `toLine` metres short of the approach's lane end (negative once over it). */
  const front = (toLine: number, speed: number): SnapOver => ({ ref: W_IN, speed, match: { edgeS: line + toLine + FRONT_OFFSET } });
  const roll = (from: number, to: number, speed: number) => repeat(Math.round((from - to) / (Math.abs(speed) * 0.1)) + 1, i => front(from - i * speed * 0.1, speed));

  test('a full stop within 10 m before the line is fine', () => {
    expect(drive(new StopSignRule(road), [...roll(40, 3, 5), ...repeat(10, front(3, 0)), ...roll(3, -10, 2)])).toEqual([]);
  });

  test('rolling through gives one, when the front goes over', () => {
    const vs = drive(new StopSignRule(road), roll(40, -10, 2));
    expect(ids(vs)).toEqual(['noFullStopAtStopSign']);
  });

  test('a stop 15 m back does not count', () => {
    expect(ids(drive(new StopSignRule(road), [...roll(40, 15, 5), ...repeat(10, front(15, 0)), ...roll(15, -10, 2)]))).toEqual(['noFullStopAtStopSign']);
  });

  test('slowing to 0.5 m/s is not a full stop', () => {
    expect(ids(drive(new StopSignRule(road), [...roll(40, 3, 5), ...repeat(10, front(3, 0.5)), ...roll(3, -10, 2)]))).toEqual(['noFullStopAtStopSign']);
  });

  test('approaches without a stop sign are not judged', () => {
    expect(drive(new StopSignRule(testRoad()), roll(40, -10, 2))).toEqual([]);
  });
});

describe('noEntry', () => {
  const road = testRoad([{ code: CODE.noEntry, edgeId: 'n', dir: 1, at: 10 }]);

  test('entering the edge against the sign, once held for 0.5 s', () => {
    const vs = drive(new NoEntryRule(road), transit(W_IN, N_OUT));
    expect(ids(vs)).toEqual(['noEntry']);
    expect(vs[0].detail).toEqual({ edge: 'n|1' });
  });

  test('a match on the edge that has not held 2 s is not an entry yet', () => {
    const into = [...transit(W_IN, W_IN, {}, { before: 10, inside: 5, after: 0 }), ...transit(W_IN, N_OUT, {}, { before: 0, inside: 5, after: 0 })];
    expect(drive(new NoEntryRule(road), [...into, ...fresh(15, { speed: 5, ref: N_OUT }), ...repeat(10, { speed: 5, ref: E_OUT })])).toEqual([]);
    expect(ids(drive(new NoEntryRule(road), [...into, ...fresh(30, { speed: 5, ref: N_OUT })]))).toEqual(['noEntry']);
  });

  test('a brief matcher flicker onto the edge is not an entry', () => {
    const flicker = [...repeat(4, { speed: 5, ref: N_OUT }), ...repeat(10, { speed: 5, ref: W_IN, match: { inJunction: 'cross', onConnector: true } })];
    expect(drive(new NoEntryRule(road), [...transit(W_IN, W_IN, {}, { before: 10, inside: 5, after: 0 }), ...flicker, ...repeat(10, { speed: 5, ref: E_OUT })])).toEqual([]);
  });

  test('other exits, a sign beyond 40 m, and reversing in are fine', () => {
    expect(drive(new NoEntryRule(road), transit(W_IN, E_OUT))).toEqual([]);
    expect(drive(new NoEntryRule(testRoad([{ code: CODE.noEntry, edgeId: 'n', dir: 1, at: 60 }])), transit(W_IN, N_OUT))).toEqual([]);
    expect(drive(new NoEntryRule(road), transit(W_IN, N_OUT, { speed: -2 }))).toEqual([]);
  });
});

describe('turnRestriction', () => {
  test('a left turn under noLeftTurn', () => {
    const road = testRoad([{ code: CODE.noLeftTurn, edgeId: 'w', dir: -1, at: 10 }]);
    expect(ids(drive(new TurnRestrictionRule(road), transit(W_IN, N_OUT)))).toEqual(['turnRestriction']);
    expect(drive(new TurnRestrictionRule(road), transit(W_IN, E_OUT))).toEqual([]);
    expect(drive(new TurnRestrictionRule(road), transit(W_IN, S_OUT))).toEqual([]);
  });

  test('a right turn under noRightTurn and a U-turn under noUTurn', () => {
    expect(ids(drive(new TurnRestrictionRule(testRoad([{ code: CODE.noRightTurn, edgeId: 'w', dir: -1, at: 10 }])), transit(W_IN, S_OUT)))).toEqual(['turnRestriction']);
    expect(ids(drive(new TurnRestrictionRule(testRoad([{ code: CODE.noUTurn, edgeId: 'w', dir: -1, at: 10 }])), transit(W_IN, W_BACK)))).toEqual(['turnRestriction']);
  });

  test('a sign on another approach does not apply', () => {
    const road = testRoad([{ code: CODE.noLeftTurn, edgeId: 'e', dir: -1, at: 10 }]);
    expect(drive(new TurnRestrictionRule(road), transit(W_IN, N_OUT))).toEqual([]);
  });
});

describe('wrongWayOneway', () => {
  const road = testRoad();
  const against = { edgeId: 'o1', dir: -1 as const, lane: 0 };

  test('more than 1.5 s against the oneway, once per entry', () => {
    expect(drive(new WrongWayOnewayRule(road), repeat(15, { ref: against, speed: 5 }))).toEqual([]);
    const vs = drive(new WrongWayOnewayRule(road), repeat(100, { ref: against, speed: 5 }));
    expect(ids(vs)).toEqual(['wrongWayOneway']);
    expect(vs[0].detail).toEqual({ edge: 'o1|-1' });
  });

  test('the time against it counts once the match has held 2 s', () => {
    expect(drive(new WrongWayOnewayRule(road), fresh(30, { ref: against, speed: 5 }))).toEqual([]);
    const vs = drive(new WrongWayOnewayRule(road), fresh(40, { ref: against, speed: 5 }));
    expect(ids(vs)).toEqual(['wrongWayOneway']);
    expect(vs[0].t).toBeCloseTo(3.5, 5);
  });

  test('stopping and going on is the same occurrence; leaving and coming back is another', () => {
    const rule = new WrongWayOnewayRule(road);
    const frames = [...repeat(20, { ref: against, speed: 5 }), ...repeat(10, { ref: against, speed: 0 }), ...repeat(20, { ref: against, speed: 5 }),
      ...repeat(5, { ref: { edgeId: 'tE', dir: 1, lane: 0 }, speed: 5 }), ...repeat(20, { ref: against, speed: 5 })];
    expect(ids(drive(rule, frames))).toEqual(['wrongWayOneway', 'wrongWayOneway']);
  });

  test('with the flow, reversing, and inside a junction are fine', () => {
    expect(drive(new WrongWayOnewayRule(road), repeat(50, { ref: { edgeId: 'o1', dir: 1, lane: 0 }, speed: 5 }))).toEqual([]);
    expect(drive(new WrongWayOnewayRule(road), repeat(50, { ref: against, speed: -2 }))).toEqual([]);
    expect(drive(new WrongWayOnewayRule(road), repeat(50, { ref: against, speed: 5, match: { inJunction: 'x', onConnector: true } }))).toEqual([]);
  });
});
