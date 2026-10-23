import { chaseOffset, lookGlance, nextMode } from './cameras';

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

test('mouse look classifies as a mirror glance', () => {
  const d = (x: number) => (x * Math.PI) / 180;
  expect(lookGlance(d(40), 0)).toBe('left');
  expect(lookGlance(d(-40), 0)).toBe('right');
  expect(lookGlance(d(10), d(15))).toBe('rear');
  expect(lookGlance(d(20), d(15))).toBeNull();
  expect(lookGlance(d(20), 0)).toBeNull();
  expect(lookGlance(d(40), d(15))).toBe('left');
});
