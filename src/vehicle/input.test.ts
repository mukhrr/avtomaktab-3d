import { InputReader } from './input';

const pad = (buttons: Record<number, number>, axes = [0, 0, 0, 0]) =>
  ({ axes, buttons: Array.from({ length: 17 }, (_, i) => ({ value: buttons[i] ?? 0, pressed: (buttons[i] ?? 0) > 0.5 })) }) as unknown as Gamepad;
const none = new Set<string>();

test('W gives full throttle', () => {
  expect(new InputReader().read(new Set(['KeyW']), none, [null], 1 / 60).throttle).toBe(1);
});

test('pad trigger gives analog throttle, and disconnecting drops it to 0', () => {
  const r = new InputReader();
  expect(r.read(none, none, [pad({ 7: 0.5 })], 1 / 60).throttle).toBe(0.5);
  expect(r.read(none, none, [null], 1 / 60).throttle).toBe(0);
});

test('shift and ignition fire once per press', () => {
  const r = new InputReader();
  expect(r.read(new Set(['KeyE']), new Set(['KeyE']), [null], 1 / 60).shiftUp).toBe(true);
  expect(r.read(new Set(['KeyE']), none, [null], 1 / 60).shiftUp).toBe(false);
});

test('keyboard steering ramps in at 3 per second, pad axis is direct', () => {
  const r = new InputReader();
  expect(r.read(new Set(['KeyD']), none, [null], 0.1).steer).toBeCloseTo(0.3);
  expect(new InputReader().read(none, none, [pad({}, [-0.6, 0, 0, 0])], 0.1).steer).toBeCloseTo(-0.6);
});

test('keyboard clutch drops in instantly and releases gradually', () => {
  const r = new InputReader();
  expect(r.read(new Set(['ShiftLeft']), none, [null], 1 / 60).clutch).toBe(1);
  const released = r.read(none, none, [null], 0.1).clutch;
  expect(released).toBeGreaterThan(0.5);
  expect(released).toBeLessThan(1);
});

test('Z, X, V, B fire once per press', () => {
  const r = new InputReader();
  const c = r.read(new Set(['KeyZ', 'KeyV']), new Set(['KeyZ', 'KeyX', 'KeyV', 'KeyB']), [null], 1 / 60);
  expect([c.toggleLeft, c.toggleRight, c.toggleHazard, c.toggleBelt]).toEqual([true, true, true, true]);
  const d = r.read(new Set(['KeyZ']), none, [null], 1 / 60);
  expect([d.toggleLeft, d.toggleRight, d.toggleHazard, d.toggleBelt]).toEqual([false, false, false, false]);
});

test('holding 1, 2, 3 glances left, rear, right', () => {
  const r = new InputReader();
  expect(r.read(new Set(['Digit1']), none, [null], 1 / 60).glance).toBe('left');
  expect(r.read(new Set(['Digit2']), none, [null], 1 / 60).glance).toBe('rear');
  expect(r.read(new Set(['Digit3']), none, [null], 1 / 60).glance).toBe('right');
  expect(r.read(none, none, [null], 1 / 60).glance).toBeNull();
});

test('pad D-pad and stick click fire on the press edge only', () => {
  const r = new InputReader();
  const c = r.read(none, none, [pad({ 14: 1, 15: 1, 13: 1, 10: 1 })], 1 / 60);
  expect([c.toggleLeft, c.toggleRight, c.toggleHazard, c.toggleBelt]).toEqual([true, true, true, true]);
  const d = r.read(none, none, [pad({ 14: 1, 15: 1, 13: 1, 10: 1 })], 1 / 60);
  expect([d.toggleLeft, d.toggleRight, d.toggleHazard, d.toggleBelt]).toEqual([false, false, false, false]);
});

test('right stick past 0.6 glances left, up (rear) or right', () => {
  const r = new InputReader();
  expect(r.read(none, none, [pad({}, [0, 0, -0.7, 0])], 1 / 60).glance).toBe('left');
  expect(r.read(none, none, [pad({}, [0, 0, 0, -0.7])], 1 / 60).glance).toBe('rear');
  expect(r.read(none, none, [pad({}, [0, 0, 0.7, 0])], 1 / 60).glance).toBe('right');
  expect(r.read(none, none, [pad({}, [0, 0, 0.5, 0.5])], 1 / 60).glance).toBeNull();
});

test('N or pad A holds the horn', () => {
  const r = new InputReader();
  expect(r.horn(new Set(['KeyN']), [null])).toBe(true);
  expect(r.horn(none, [pad({ 0: 1 })])).toBe(true);
  expect(r.horn(none, [null])).toBe(false);
});
