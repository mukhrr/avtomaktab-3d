import { fixedSteps, splitControls, NO_EDGES } from './loop';
import type { Controls } from '../vehicle/drivetrain';

const idle: Controls = { throttle: 0, brake: 0, clutch: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, ignition: false };

test('one frame at 60 Hz is one step', () => {
  expect(fixedSteps(0, 1 / 60)).toEqual({ steps: 1, accumulator: expect.closeTo(0, 9) });
});

test('a 50 ms frame runs 3 steps', () => {
  const r = fixedSteps(0, 0.05);
  expect(r.steps).toBe(3);
  expect(r.accumulator).toBeCloseTo(0, 6);
});

test('a 3 s gap (tab was hidden) caps at 5 steps and drops the backlog', () => {
  expect(fixedSteps(0, 3)).toEqual({ steps: 5, accumulator: 0 });
});

test('a gear press applies to the first substep only', () => {
  const { perStep } = splitControls({ ...idle, shiftUp: true }, NO_EDGES, 2);
  expect(perStep.map(c => c.shiftUp)).toEqual([true, false]);
});

test('a press during a frame with no substeps is kept for the next one', () => {
  const a = splitControls({ ...idle, ignition: true }, NO_EDGES, 0);
  expect(a.perStep).toEqual([]);
  const b = splitControls(idle, a.pending, 1);
  expect(b.perStep[0].ignition).toBe(true);
  expect(b.pending).toEqual(NO_EDGES);
});
