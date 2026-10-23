import type { GameEvent } from '../../sim/events';
import { CollisionRule } from './collisions';
import { drive, ids, repeat, type SnapOver } from './testSnap';

const car = (speed: number): GameEvent => ({ type: 'collision', with: 'car', speed, time: 0 });
const wall = (speed: number): GameEvent => ({ type: 'collision', with: 'building', speed, time: 0 });
const ped = (pedId: number, speed = 4): GameEvent => ({ type: 'pedestrianHit', pedId, speed, time: 0 });
/** `speed` throughout, with `events` arriving on the listed frames. */
const run = (speed: number, at: Record<number, GameEvent[]>, n = 60): SnapOver[] =>
  repeat(n, i => ({ speed, events: at[i] ?? [] }));

describe('collisions', () => {
  test('an AI car rear-ending the stationary player gives nothing, even with the push in the same step', () => {
    const frames = [...repeat(10, { speed: 0 }), { speed: 1.8, events: [car(5)] }, ...repeat(10, { speed: 1 })];
    expect(drive(new CollisionRule(), frames)).toEqual([]);
  });

  test('driving into a car gives one; three contacts within 1 s are still one', () => {
    expect(ids(drive(new CollisionRule(), run(5, { 10: [car(5)] })))).toEqual(['collisionCar']);
    expect(ids(drive(new CollisionRule(), run(5, { 10: [car(5)], 13: [car(2)], 19: [car(1)] })))).toEqual(['collisionCar']);
  });

  test('a second crash more than 3 s after the first is another', () => {
    expect(ids(drive(new CollisionRule(), run(5, { 5: [car(5)], 40: [car(5)] })))).toEqual(['collisionCar', 'collisionCar']);
  });

  test('a bump while standing does not open the window for a real crash after it', () => {
    const frames = [...repeat(10, { speed: 0 }), { speed: 0.5, events: [car(3)] }, ...repeat(4, { speed: 3 }), { speed: 3, events: [car(4)] }];
    expect(ids(drive(new CollisionRule(), frames))).toEqual(['collisionCar']);
  });

  test('touching a building below 2 m/s gives nothing; above, one per crash', () => {
    expect(drive(new CollisionRule(), run(1.5, { 10: [wall(1.5)] }))).toEqual([]);
    expect(ids(drive(new CollisionRule(), run(3, { 10: [wall(3)], 12: [wall(2.5), wall(2.5)], 15: [wall(2.1)] })))).toEqual(['collisionObstacle']);
  });

  test('hitting a pedestrian gives one; two hit in the same crash are one', () => {
    const vs = drive(new CollisionRule(), run(4, { 10: [ped(3), ped(4)] }));
    expect(ids(vs)).toEqual(['collisionPedestrian']);
    expect(vs[0].detail).toEqual({ ped: 3 });
  });

  test('a car crash and a wall in the same moment are separate partners', () => {
    expect(ids(drive(new CollisionRule(), run(5, { 10: [car(5), wall(5)] })))).toEqual(['collisionCar', 'collisionObstacle']);
  });

  test('reset clears the debounce', () => {
    const rule = new CollisionRule();
    drive(rule, run(5, { 1: [car(5)] }, 3));
    rule.reset();
    expect(ids(drive(rule, run(5, { 1: [car(5)] }, 3)))).toEqual(['collisionCar']);
  });
});
