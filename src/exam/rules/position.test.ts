import type { DriveSnapshot } from '../snapshot';
import { OncomingLaneRule, StoppedOnCrossingRule } from './position';
import { W_BACK, W_IN, testRoad } from './testRoad';
import { drive, fresh, ids, repeat, type SnapOver } from './testSnap';

describe('oncomingLane', () => {
  const road = testRoad();
  const at = (lateral: number, over: SnapOver = {}): SnapOver => ({ speed: 8, ref: W_IN, ...over, match: { lateral, ...over.match } });

  test('more than 0.9 m beyond the centreline for over 1 s gives one', () => {
    const vs = drive(new OncomingLaneRule(road), [...repeat(5, at(1.75)), ...repeat(12, at(-1))]);
    expect(ids(vs)).toEqual(['oncomingLane']);
    expect(vs[0].t).toBeCloseTo(1.4, 5);
  });

  test('0.8 m over, or 0.9 s over, gives none', () => {
    expect(drive(new OncomingLaneRule(road), repeat(30, at(-0.8)))).toEqual([]);
    expect(drive(new OncomingLaneRule(road), [...repeat(9, at(-1)), ...repeat(5, at(1)), ...repeat(9, at(-1))])).toEqual([]);
  });

  test('once per stay over the line; coming back and going over again is another', () => {
    const over = repeat(40, at(-1.5));
    expect(ids(drive(new OncomingLaneRule(road), over))).toEqual(['oncomingLane']);
    expect(ids(drive(new OncomingLaneRule(road), [...over, ...repeat(5, at(1.75)), ...over]))).toEqual(['oncomingLane', 'oncomingLane']);
  });

  test('not judged inside a junction or on a connector, nor while reversing (ruling 1)', () => {
    expect(drive(new OncomingLaneRule(road), repeat(30, at(-2, { match: { inJunction: 'cross', onConnector: true } })))).toEqual([]);
    expect(drive(new OncomingLaneRule(road), repeat(30, at(-2, { match: { onConnector: true } })))).toEqual([]);
    expect(drive(new OncomingLaneRule(road), repeat(30, at(-2, { speed: -2 })))).toEqual([]);
  });

  test('a match that has not held 2 s is not judged; once it has, the stay over the line counts', () => {
    expect(drive(new OncomingLaneRule(road), fresh(19, at(-1.5)))).toEqual([]);
    const vs = drive(new OncomingLaneRule(road), fresh(40, at(-1.5)));
    expect(ids(vs)).toEqual(['oncomingLane']);
    expect(vs[0].t).toBeCloseTo(2.9, 5);
  });

  test('a oneway has no oncoming lane', () => {
    expect(drive(new OncomingLaneRule(road), repeat(30, at(-1.5, { ref: { edgeId: 'o1', dir: 1, lane: 0 } })))).toEqual([]);
  });

  test('the line is the divider between the directions, not the middle of an uneven road', () => {
    const uneven = testRoad([], d => Object.assign(d.graph.edges.find(e => e.id === 'w')!, { lanesForward: 2, width: 10.5 }));
    const back = (lateral: number) => at(lateral, { ref: { ...W_BACK, lane: 1 } });
    expect(drive(new OncomingLaneRule(uneven), repeat(30, back(-1.2)))).toEqual([]);
    expect(ids(drive(new OncomingLaneRule(uneven), repeat(30, back(-2.8))))).toEqual(['oncomingLane']);
  });
});

describe('stoppedOnCrossing', () => {
  type Crossing = DriveSnapshot['crossingsAhead'][number];
  const xing = (distance: number, kind: Crossing['kind'] = 'zebra'): Crossing =>
    ({ id: 'z1', distance, occupied: false, kind, pedOnCarriageway: false, pedAtCurb: false });
  const still = (distance: number, n: number, kind?: Crossing['kind']) => repeat(n, { speed: 0, crossingsAhead: [xing(distance, kind)] });

  test('stopped 2 s with the front on the band gives one, once per stop', () => {
    const vs = drive(new StoppedOnCrossingRule(), still(3, 50));
    expect(ids(vs)).toEqual(['stoppedOnCrossing']);
    expect(vs[0].detail).toEqual({ crossing: 'z1' });
  });

  test('the middle of the car or only the rear on it counts too', () => {
    expect(ids(drive(new StoppedOnCrossingRule(), still(0, 25)))).toEqual(['stoppedOnCrossing']);
    expect(ids(drive(new StoppedOnCrossingRule(), still(-3, 25)))).toEqual(['stoppedOnCrossing']);
  });

  test('the nose 0.5 m or less into the band, or 1.9 s, or creeping at 0.5 m/s gives none', () => {
    expect(drive(new StoppedOnCrossingRule(), still(3.3, 40))).toEqual([]);
    expect(drive(new StoppedOnCrossingRule(), still(-3.3, 40))).toEqual([]);
    expect(drive(new StoppedOnCrossingRule(), still(0, 19))).toEqual([]);
    expect(drive(new StoppedOnCrossingRule(), repeat(40, { speed: 0.5, crossingsAhead: [xing(0)] }))).toEqual([]);
  });

  test('stopping, moving off and stopping on it again is two', () => {
    const frames = [...still(2, 25), ...repeat(5, { speed: 1, crossingsAhead: [xing(1.5)] }), ...still(1, 25)];
    expect(ids(drive(new StoppedOnCrossingRule(), frames))).toEqual(['stoppedOnCrossing', 'stoppedOnCrossing']);
  });

  test('unmarked crossings are not judged', () => {
    expect(drive(new StoppedOnCrossingRule(), still(0, 40, 'unmarked'))).toEqual([]);
  });
});
