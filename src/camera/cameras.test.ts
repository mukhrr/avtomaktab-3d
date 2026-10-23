import { chaseOffset, nextMode } from './cameras';

test('chase camera pulls back with speed up to 10 m', () => {
  expect(chaseOffset(0, 0)).toEqual({ back: 7, up: 2.8 });
  expect(chaseOffset(0, 30).back).toBeCloseTo(8.5);
  expect(chaseOffset(0, 100).back).toBe(10);
});

test('C cycles chase, cockpit, top', () => {
  expect(nextMode('chase')).toBe('cockpit');
  expect(nextMode('cockpit')).toBe('top');
  expect(nextMode('top')).toBe('chase');
});
