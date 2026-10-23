import type { CabinState } from '../../vehicle/cabin';
import { MirrorCheckRule, IndicatorRule, PullOffRule, SeatBeltRule } from './signalling';
import { E_OUT, N_OUT, S_OUT, W_IN, testRoad, transit } from './testRoad';
import { drive, ids, repeat, type SnapOver } from './testSnap';

const road = testRoad();
/** transit() enters the junction at frame 20, t = 2. */
const ENTRY = 2;
const NEVER = { left: -Infinity, rear: -Infinity, right: -Infinity };

/** A transit whose frame i gets cabin(i). */
function turn(to: typeof N_OUT, cabin: (i: number) => Partial<CabinState>, speed = 5): SnapOver[] {
  return transit(W_IN, to).map((f, i) => ({ ...f, speed, cabin: cabin(i) }));
}

const lane = (n: number) => ({ edgeId: 'tE', dir: 1 as const, lane: n });
/** 2 s in lane 0, then lane 1 from t = 2 for `held` frames. */
function laneChange(to: number, cabin: (i: number) => Partial<CabinState> = () => ({}), held = 15, speed = 8): SnapOver[] {
  return [...repeat(20, { ref: lane(0), speed }), ...repeat(held, { ref: lane(to), speed })].map((f, i) => ({ ...f, cabin: cabin(i) }));
}

describe('noIndicator', () => {
  test('a left turn with the left indicator on well before is fine, even after it auto-cancels', () => {
    expect(drive(new IndicatorRule(road), turn(N_OUT, i => ({ indicator: i < 25 ? 'left' : null })))).toEqual([]);
    expect(drive(new IndicatorRule(road), turn(S_OUT, () => ({ indicator: 'right' })))).toEqual([]);
  });

  test('indicator turned on 0.5 s before the turn gives noIndicator', () => {
    const vs = drive(new IndicatorRule(road), turn(N_OUT, i => ({ indicator: i >= 15 ? 'left' : null })));
    expect(ids(vs)).toEqual(['noIndicator']);
    expect(vs[0].detail).toMatchObject({ maneuver: 'left' });
  });

  test('exactly 1 s before is enough', () => {
    expect(drive(new IndicatorRule(road), turn(N_OUT, i => ({ indicator: i >= 10 ? 'left' : null })))).toEqual([]);
  });

  test('no indicator, the wrong one, or hazards instead', () => {
    expect(ids(drive(new IndicatorRule(road), turn(N_OUT, () => ({}))))).toEqual(['noIndicator']);
    expect(ids(drive(new IndicatorRule(road), turn(N_OUT, () => ({ indicator: 'right' }))))).toEqual(['noIndicator']);
    expect(ids(drive(new IndicatorRule(road), turn(N_OUT, () => ({ indicator: 'left', hazard: true }))))).toEqual(['noIndicator']);
  });

  test('straight on needs nothing', () => {
    expect(drive(new IndicatorRule(road), turn(E_OUT, () => ({})))).toEqual([]);
  });

  test('a turn made in reverse is not judged', () => {
    expect(drive(new IndicatorRule(road), turn(N_OUT, () => ({}), -2))).toEqual([]);
  });

  test('lane changes: unsignalled gives one, signalled is fine, a 0.5 s wobble is nothing', () => {
    expect(ids(drive(new IndicatorRule(road), laneChange(1)))).toEqual(['noIndicator']);
    expect(drive(new IndicatorRule(road), laneChange(1, () => ({ indicator: 'left' })))).toEqual([]);
    expect(drive(new IndicatorRule(road), laneChange(0, () => ({}), 15).slice(0, 20).concat(repeat(5, { ref: lane(1), speed: 8 }), repeat(10, { ref: lane(0), speed: 8 })))).toEqual([]);
    expect(ids(drive(new IndicatorRule(road), laneChange(1, () => ({ indicator: 'right' }))))).toEqual(['noIndicator']);
  });

  test('lane index changes inside a junction or while reversing are not lane changes', () => {
    const junction = { match: { inJunction: 'cross', onConnector: true } };
    expect(drive(new IndicatorRule(road), laneChange(1).map(f => ({ ...f, ...junction })))).toEqual([]);
    expect(drive(new IndicatorRule(road), laneChange(1, () => ({}), 15, -2))).toEqual([]);
  });
});

describe('after a junction exit', () => {
  const twoLaneN = testRoad([], d => { const n = d.graph.edges.find(e => e.id === 'n')!; n.lanesForward = 2; n.width = 10.5; });
  const nLane = (k: number) => ({ ...N_OUT, lane: k });
  const signalled = { indicator: 'left' as const, lastGlance: { ...NEVER, left: 1.5 } };
  const exit = (lanes: number[]) => [...transit(W_IN, N_OUT, { cabin: signalled }, { before: 20, inside: 15, after: 0 }), ...lanes.map(k => ({ speed: 5, ref: nLane(k) }))];

  test('a wide turn reading the far lane briefly is not a lane change', () => {
    const frames = exit([...Array(3).fill(1), ...Array(15).fill(0)]);
    expect(drive(new IndicatorRule(twoLaneN), frames)).toEqual([]);
    expect(drive(new MirrorCheckRule(twoLaneN), frames)).toEqual([]);
  });

  test('a real lane change once the exit lane has settled still counts', () => {
    const frames = exit([...Array(15).fill(0), ...Array(12).fill(1)]);
    expect(ids(drive(new IndicatorRule(twoLaneN), frames))).toEqual(['noIndicator']);
  });
});

describe('noMirrorCheck', () => {
  const lit = { indicator: 'left' as const };
  test('a glance 7 s before gives noMirrorCheck, 5 s before gives none', () => {
    const seven = drive(new MirrorCheckRule(road), turn(N_OUT, () => ({ ...lit, lastGlance: { ...NEVER, left: ENTRY - 7 } })));
    expect(ids(seven)).toEqual(['noMirrorCheck']);
    expect(drive(new MirrorCheckRule(road), turn(N_OUT, () => ({ ...lit, lastGlance: { ...NEVER, left: ENTRY - 5 } })))).toEqual([]);
  });

  test('the mirror must be on the side of the maneuver', () => {
    expect(ids(drive(new MirrorCheckRule(road), turn(N_OUT, () => ({ ...lit, lastGlance: { ...NEVER, right: ENTRY - 1, rear: ENTRY - 1 } }))))).toEqual(['noMirrorCheck']);
    expect(drive(new MirrorCheckRule(road), turn(S_OUT, () => ({ indicator: 'right', lastGlance: { ...NEVER, right: ENTRY - 1 } })))).toEqual([]);
  });

  test('a glance only after the maneuver started is too late', () => {
    expect(ids(drive(new MirrorCheckRule(road), turn(N_OUT, i => ({ ...lit, lastGlance: { ...NEVER, left: i >= 22 ? ENTRY + 0.2 : -Infinity } }))))).toEqual(['noMirrorCheck']);
  });

  test('lane changes', () => {
    expect(ids(drive(new MirrorCheckRule(road), laneChange(1, () => lit)))).toEqual(['noMirrorCheck']);
    expect(drive(new MirrorCheckRule(road), laneChange(1, () => ({ ...lit, lastGlance: { ...NEVER, left: 0.5 } })))).toEqual([]);
  });
});

describe('noIndicatorPullOff', () => {
  const start = (cabin: Partial<CabinState>) => [...repeat(10, { speed: 0, cabin }), ...repeat(10, { speed: 2, cabin })];

  test('moving off from rest without the left indicator, once per drive', () => {
    const rule = new PullOffRule();
    expect(ids(drive(rule, [...start({}), ...repeat(10, { speed: 0 }), ...repeat(10, { speed: 3 })]))).toEqual(['noIndicatorPullOff']);
  });

  test('with the left indicator it is fine; hazards or right are not', () => {
    expect(drive(new PullOffRule(), start({ indicator: 'left' }))).toEqual([]);
    expect(ids(drive(new PullOffRule(), start({ indicator: 'left', hazard: true })))).toEqual(['noIndicatorPullOff']);
    expect(ids(drive(new PullOffRule(), start({ indicator: 'right' })))).toEqual(['noIndicatorPullOff']);
  });

  test('reversing first is not the pull-off; reset arms it again', () => {
    const rule = new PullOffRule();
    expect(drive(rule, [...repeat(5, { speed: 0 }), ...repeat(5, { speed: -1 }), ...repeat(5, { speed: 0 }), ...repeat(5, { speed: 2, cabin: { indicator: 'left' } })])).toEqual([]);
    rule.reset();
    expect(ids(drive(rule, start({})))).toEqual(['noIndicatorPullOff']);
  });
});

describe('noSeatBelt', () => {
  test('above 5 km/h without the belt, once per drive', () => {
    expect(ids(drive(new SeatBeltRule(), repeat(50, i => ({ speed: 2, cabin: { belt: i > 20 && i < 30 } }))))).toEqual(['noSeatBelt']);
  });

  test('creeping at 4 km/h or belted is fine', () => {
    expect(drive(new SeatBeltRule(), repeat(50, { speed: 4 / 3.6, cabin: { belt: false } }))).toEqual([]);
    expect(drive(new SeatBeltRule(), repeat(50, { speed: 15 }))).toEqual([]);
  });
});
