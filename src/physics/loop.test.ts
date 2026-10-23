import { fixedSteps } from './loop';

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
