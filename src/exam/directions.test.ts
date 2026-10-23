import { DirectionTracker } from './directions';

const keys = (p: { key: string }[]) => p.map(x => x.key);

test('left turn: ahead at 50 m, now at 15 m, each once', () => {
  const d = new DirectionTracker();
  expect(d.update(80, 'left', false)).toEqual([]);
  expect(keys(d.update(50, 'left', false))).toEqual(['exam.turnLeftAhead']);
  expect(d.update(30, 'left', false)).toEqual([]);
  expect(keys(d.update(15, 'left', false))).toEqual(['exam.turnLeftNow']);
  expect(d.update(5, 'left', false)).toEqual([]);
});

test('right turn keys', () => {
  const d = new DirectionTracker();
  expect(keys(d.update(40, 'right', false))).toEqual(['exam.turnRightAhead']);
  expect(keys(d.update(10, 'right', false))).toEqual(['exam.turnRightNow']);
});

test('a step that begins closer than 50 m announces at once', () => {
  const d = new DirectionTracker();
  expect(keys(d.update(32, 'left', false))).toEqual(['exam.turnLeftAhead']);
});

test('a step that begins inside 15 m only says now', () => {
  const d = new DirectionTracker();
  expect(keys(d.update(9, 'right', false))).toEqual(['exam.turnRightNow']);
});

test('straight is only announced when the caller says the junction is signalled', () => {
  expect(keys(new DirectionTracker().update(45, 'straight', true))).toEqual(['exam.straight']);
  const d = new DirectionTracker();
  expect(d.update(45, 'straight', false)).toEqual([]);
  expect(d.update(10, 'straight', true)).toEqual([]);
});

test('u-turn is announced once', () => {
  const d = new DirectionTracker();
  expect(keys(d.update(45, 'uturn', false))).toEqual(['exam.uturn']);
  expect(d.update(10, 'uturn', false)).toEqual([]);
});

test('finish: ahead then stop here', () => {
  const d = new DirectionTracker();
  expect(keys(d.update(48, 'finish', false))).toEqual(['exam.finishAhead']);
  expect(keys(d.update(14, 'finish', false))).toEqual(['exam.stopHere']);
});

test('nothing once the junction is behind', () => {
  const d = new DirectionTracker();
  expect(d.update(-2, 'left', false)).toEqual([]);
});
