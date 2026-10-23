import { newCabin, stepCabin } from './cabin';
import type { Controls } from './drivetrain';

const idle: Controls = { throttle: 0, brake: 0, clutch: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, ignition: false, toggleLeft: false, toggleRight: false, toggleHazard: false, toggleBelt: false, glance: null };
const press = (p: Partial<Controls>) => ({ ...idle, ...p });

test('Z toggles left on and off, X while left switches to right', () => {
  let s = stepCabin(newCabin(), press({ toggleLeft: true }), 0);
  expect(s.indicator).toBe('left');
  s = stepCabin(s, press({ toggleRight: true }), 0.1);
  expect(s.indicator).toBe('right');
  s = stepCabin(s, press({ toggleRight: true }), 0.2);
  expect(s.indicator).toBeNull();
  s = stepCabin(s, press({ toggleLeft: true }), 0.3);
  s = stepCabin(s, press({ toggleLeft: true }), 0.4);
  expect(s.indicator).toBeNull();
});

const on = (side: 'toggleLeft' | 'toggleRight') => stepCabin(newCabin(), press({ [side]: true }), 0);
const steer = (s: ReturnType<typeof newCabin>, v: number, t: number) => stepCabin(s, press({ steer: v }), t);

test('indicator cancels after steering left past 0.35 and straightening', () => {
  let s = on('toggleLeft');
  s = steer(s, -0.4, 1);
  expect(s.indicator).toBe('left');
  s = steer(s, -0.1, 2);
  expect(s.indicator).toBe('left');
  s = steer(s, 0.02, 3);
  expect(s.indicator).toBeNull();
});

test('right indicator cancels after a right turn', () => {
  let s = on('toggleRight');
  s = steer(s, 0.5, 1);
  s = steer(s, 0.02, 2);
  expect(s.indicator).toBeNull();
});

test('arm threshold: -0.30 then 0 stays on, -0.40 then 0 cancels', () => {
  let s = steer(steer(on('toggleLeft'), -0.3, 1), 0, 2);
  expect(s.indicator).toBe('left');
  s = steer(steer(on('toggleLeft'), -0.4, 1), 0, 2);
  expect(s.indicator).toBeNull();
});

test('steering fully the wrong way does not cancel', () => {
  const s = steer(steer(on('toggleLeft'), 1, 1), 0, 2);
  expect(s.indicator).toBe('left');
});

test('a wiggle below 0.35 does not cancel', () => {
  let s = on('toggleLeft');
  for (const v of [-0.2, 0.2, -0.3, 0, 0.3, 0.01]) s = steer(s, v, 1);
  expect(s.indicator).toBe('left');
});

test('hazard and belt toggle, and hazard leaves the indicator alone', () => {
  let s = stepCabin(newCabin(), press({ toggleLeft: true, toggleHazard: true, toggleBelt: true }), 0);
  expect([s.indicator, s.hazard, s.belt]).toEqual(['left', true, true]);
  s = stepCabin(s, press({ toggleHazard: true, toggleBelt: true }), 1);
  expect([s.indicator, s.hazard, s.belt]).toEqual(['left', false, false]);
});

test('the belt starts unfastened', () => {
  expect(newCabin().belt).toBe(false);
});

test('a glance stamps lastGlance while held and stops when released', () => {
  const s0 = newCabin();
  expect(s0.lastGlance).toEqual({ left: -Infinity, rear: -Infinity, right: -Infinity });
  let s = stepCabin(s0, press({ glance: 'rear' }), 5);
  s = stepCabin(s, press({ glance: 'rear' }), 5.5);
  expect(s.glance).toBe('rear');
  expect(s.lastGlance.rear).toBe(5.5);
  s = stepCabin(s, idle, 6);
  expect(s.glance).toBeNull();
  expect(s.lastGlance).toEqual({ left: -Infinity, rear: 5.5, right: -Infinity });
});
