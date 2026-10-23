import type { LaneRef } from '../../traffic/lanes';
import { WrongLaneForTurnRule } from './lanes';
import { E_OUT, N_OUT, S_OUT, W_BACK, W_IN, testRoad, transit } from './testRoad';
import { drive, ids } from './testSnap';

/** Arm w carries two lanes towards the cross. */
const road = testRoad([], d => {
  const w = d.graph.edges.find(e => e.id === 'w')!;
  w.lanesBackward = 2;
  w.width = 10.5;
});
const from = (lane: number): LaneRef => ({ ...W_IN, lane });

test('a left turn from the rightmost of two lanes is wrong, from the leftmost it is fine', () => {
  const vs = drive(new WrongLaneForTurnRule(road), transit(from(0), N_OUT));
  expect(ids(vs)).toEqual(['wrongLaneForTurn']);
  expect(vs[0].detail).toMatchObject({ turn: 'left', lane: 0, lanes: 2 });
  expect(drive(new WrongLaneForTurnRule(road), transit(from(1), N_OUT))).toEqual([]);
});

test('a right turn from the leftmost lane is wrong, from the rightmost it is fine', () => {
  expect(ids(drive(new WrongLaneForTurnRule(road), transit(from(1), S_OUT)))).toEqual(['wrongLaneForTurn']);
  expect(drive(new WrongLaneForTurnRule(road), transit(from(0), S_OUT))).toEqual([]);
});

test('a U-turn counts as a left turn', () => {
  expect(ids(drive(new WrongLaneForTurnRule(road), transit(from(0), W_BACK)))).toEqual(['wrongLaneForTurn']);
});

test('straight on from either lane is fine', () => {
  expect(drive(new WrongLaneForTurnRule(road), transit(from(0), E_OUT))).toEqual([]);
  expect(drive(new WrongLaneForTurnRule(road), transit(from(1), E_OUT))).toEqual([]);
});

test('single-lane approaches are not judged', () => {
  expect(drive(new WrongLaneForTurnRule(testRoad()), transit(W_IN, N_OUT))).toEqual([]);
});

test('the approach lane is the one held before the junction, not one read inside it', () => {
  const frames = transit(from(1), N_OUT).map((f, i) => (i >= 20 && i < 35 ? { ...f, ref: from(0) } : f));
  expect(drive(new WrongLaneForTurnRule(road), frames)).toEqual([]);
});

test('a turn made in reverse is not judged', () => {
  expect(drive(new WrongLaneForTurnRule(road), transit(from(0), N_OUT, { speed: -2 }))).toEqual([]);
});

test('a late move into the left lane under 1 s before the junction is judged from the new lane', () => {
  const frames = transit(from(0), N_OUT).map((f, i) => (i >= 14 && i < 20 ? { ...f, ref: from(1) } : f));
  expect(drive(new WrongLaneForTurnRule(road), frames)).toEqual([]);
});
