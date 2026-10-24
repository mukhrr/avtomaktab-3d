import { newCabin, stepCabin } from './cabin';
import type { Controls } from './drivetrain';

const idle: Controls = { throttle: 0, brake: 0, clutch: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, ignition: false, toggleLeft: false, toggleRight: false, toggleHazard: false, toggleBelt: false, glance: null };
const press = (p: Partial<Controls>) => ({ ...idle, ...p });

test('Z toggles left on and off, X while left switches to right', () => {
  let s = stepCabin(newCabin(), press({ toggleLeft: true }), 0, 0);
  expect(s.indicator).toBe('left');
  s = stepCabin(s, press({ toggleRight: true }), 0.1, 0);
  expect(s.indicator).toBe('right');
  s = stepCabin(s, press({ toggleRight: true }), 0.2, 0);
  expect(s.indicator).toBeNull();
  s = stepCabin(s, press({ toggleLeft: true }), 0.3, 0);
  s = stepCabin(s, press({ toggleLeft: true }), 0.4, 0);
  expect(s.indicator).toBeNull();
});

const DEG = Math.PI / 180;
const on = (side: 'toggleLeft' | 'toggleRight') => stepCabin(newCabin(), press({ [side]: true }), 0, 0);
/** One step with the given steer input and car heading in degrees (left turns raise it). */
const at = (s: ReturnType<typeof newCabin>, steer: number, deg: number, t: number) => stepCabin(s, press({ steer }), t, deg * DEG);

test('left indicator cancels once the car has turned 30 degrees left and the wheel is straight', () => {
  let s = on('toggleLeft');
  s = at(s, -1, 20, 1);
  s = at(s, 0, 25, 1.5);
  expect(s.indicator).toBe('left');
  s = at(s, -1, 45, 2);
  expect(s.indicator).toBe('left');
  s = at(s, 0.02, 90, 3);
  expect(s.indicator).toBeNull();
});

test('right indicator cancels after a right turn, measured from where it was switched on', () => {
  let s = stepCabin(newCabin(), press({ toggleRight: true }), 0, 100 * DEG);
  s = at(s, 1, 80, 1);
  s = at(s, 0, 75, 2);
  expect(s.indicator).toBe('right');
  s = at(s, 1, 60, 3);
  s = at(s, 0, 10, 4);
  expect(s.indicator).toBeNull();
});

test('a full keyboard tap without the car turning far does not cancel: lane changes keep the stalk on', () => {
  let s = on('toggleLeft');
  for (const [steer, deg] of [[-0.75, 2], [-0.2, 6], [0, 8], [0.6, 6], [0, 0]] as const) s = at(s, steer, deg, 1);
  expect(s.indicator).toBe('left');
});

test('turning the wrong way never cancels', () => {
  const s = at(at(on('toggleLeft'), 1, -90, 1), 0, -90, 2);
  expect(s.indicator).toBe('left');
});

test('a U-turn cancels once, despite the heading wrapping past 180 degrees', () => {
  let s = stepCabin(newCabin(), press({ toggleLeft: true }), 0, 170 * DEG);
  s = at(s, -1, 230, 1);
  s = at(s, -1, 330, 2);
  s = at(s, 0, 350, 3);
  expect(s.indicator).toBeNull();
});

test('hazard and belt toggle, and hazard leaves the indicator alone', () => {
  let s = stepCabin(newCabin(), press({ toggleLeft: true, toggleHazard: true, toggleBelt: true }), 0, 0);
  expect([s.indicator, s.hazard, s.belt]).toEqual(['left', true, true]);
  s = stepCabin(s, press({ toggleHazard: true, toggleBelt: true }), 1, 0);
  expect([s.indicator, s.hazard, s.belt]).toEqual(['left', false, false]);
});

test('the belt starts unfastened', () => {
  expect(newCabin().belt).toBe(false);
});

test('a glance stamps lastGlance while held and stops when released', () => {
  const s0 = newCabin();
  expect(s0.lastGlance).toEqual({ left: -Infinity, rear: -Infinity, right: -Infinity });
  let s = stepCabin(s0, press({ glance: 'rear' }), 5, 0);
  s = stepCabin(s, press({ glance: 'rear' }), 5.5, 0);
  expect(s.glance).toBe('rear');
  expect(s.lastGlance.rear).toBe(5.5);
  s = stepCabin(s, idle, 6, 0);
  expect(s.glance).toBeNull();
  expect(s.lastGlance).toEqual({ left: -Infinity, rear: 5.5, right: -Infinity });
});
