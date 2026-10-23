import { engineTorque, stepDrivetrain, type Controls, type DrivetrainState } from './drivetrain';

const idle: Controls = { throttle: 0, brake: 0, clutch: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, ignition: false };
const manual = (gear: number): DrivetrainState => ({ gearbox: 'manual', gear, rpm: 800, running: true });

test('torque curve', () => {
  expect(engineTorque(4000)).toBe(134);
  expect(engineTorque(3000)).toBeGreaterThan(120);
  expect(engineTorque(3000)).toBeLessThan(134);
  expect(engineTorque(7000)).toBe(0);
});

test('releasing the clutch in 1st at a standstill without gas stalls', () => {
  expect(stepDrivetrain(manual(1), idle, 0, 1 / 60).state.running).toBe(false);
});

test('clutch engaged at 3 m/s in 1st locks rpm to the wheels and drives', () => {
  const r = stepDrivetrain(manual(1), { ...idle, throttle: 1 }, 3, 1 / 60);
  expect(r.state.rpm).toBeGreaterThan(1363);
  expect(r.state.rpm).toBeLessThan(1403);
  expect(r.state.running).toBe(true);
  expect(r.wheelForce).toBeGreaterThan(0);
});

test('neutral sends no force', () => {
  expect(stepDrivetrain(manual(0), { ...idle, throttle: 1 }, 5, 1 / 60).wheelForce).toBe(0);
});

test('automatic upshifts to 3rd or higher at 20 m/s within 2 s', () => {
  let s: DrivetrainState = { gearbox: 'auto', gear: 1, rpm: 800, running: true };
  for (let i = 0; i < 120; i++) s = stepDrivetrain(s, { ...idle, throttle: 0.4 }, 20, 1 / 60).state;
  expect(s.gear).toBeGreaterThanOrEqual(3);
});

test('a stalled engine sends no force and restarts with ignition when clutch is down', () => {
  const off: DrivetrainState = { ...manual(1), running: false, rpm: 0 };
  expect(stepDrivetrain(off, { ...idle, throttle: 1 }, 0, 1 / 60).wheelForce).toBe(0);
  expect(stepDrivetrain(off, { ...idle, ignition: true }, 0, 1 / 60).state.running).toBe(false);
  const on = stepDrivetrain(off, { ...idle, ignition: true, clutch: 1 }, 0, 1 / 60).state;
  expect(on).toMatchObject({ running: true, rpm: 800 });
});

test('manual shifts need the clutch down', () => {
  expect(stepDrivetrain(manual(1), { ...idle, shiftUp: true, throttle: 1 }, 5, 1 / 60).state.gear).toBe(1);
  expect(stepDrivetrain(manual(1), { ...idle, shiftUp: true, clutch: 1 }, 5, 1 / 60).state.gear).toBe(2);
});

const auto = (gear: number): DrivetrainState => ({ gearbox: 'auto', gear, rpm: 800, running: true });

test('automatic: holding the brake at a standstill (red light) never selects reverse', () => {
  let s = auto(1);
  for (let i = 0; i < 180; i++) s = stepDrivetrain(s, { ...idle, brake: 1 }, 0, 1 / 60).state;
  const r = stepDrivetrain(s, { ...idle, brake: 1 }, 0, 1 / 60);
  expect(r.state.gear).toBe(1);
  expect(r.wheelForce).toBe(0);
  expect(r.brake).toBe(1);
});

test('automatic: gear-down at a standstill selects R, throttle drives backwards, gear-up returns to D', () => {
  const r = stepDrivetrain(auto(1), { ...idle, shiftDown: true }, 0, 1 / 60);
  expect(r.state.gear).toBe(-1);
  const back = stepDrivetrain(r.state, { ...idle, throttle: 1, brake: 0.5 }, 0, 1 / 60);
  expect(back.wheelForce).toBeLessThan(0);
  expect(back.brake).toBe(0.5);
  expect(stepDrivetrain(r.state, { ...idle, shiftUp: true }, 0, 1 / 60).state.gear).toBe(1);
});

test('automatic: gear selector is ignored while moving', () => {
  expect(stepDrivetrain(auto(2), { ...idle, shiftDown: true }, 10, 1 / 60).state.gear).not.toBe(-1);
});

test('automatic: no drive force past the rev limit, so reverse tops out', () => {
  expect(stepDrivetrain(auto(-1), { ...idle, throttle: 1 }, -20, 1 / 60).wheelForce).toBe(0);
  expect(stepDrivetrain(auto(5), { ...idle, throttle: 1 }, 80, 1 / 60).wheelForce).toBe(0);
});

test('manual: rolling backwards in 1st with the clutch out stalls', () => {
  expect(stepDrivetrain(manual(1), { ...idle, throttle: 1 }, -3, 1 / 60).state.running).toBe(false);
});

test('manual: rolling forwards in reverse with the clutch out stalls', () => {
  expect(stepDrivetrain(manual(-1), { ...idle, throttle: 1 }, 3, 1 / 60).state.running).toBe(false);
});
