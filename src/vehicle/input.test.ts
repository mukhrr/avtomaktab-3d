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
