import { cycleLength, phaseLength } from './signals';

const a = { edgeId: 'e', dir: 1 as const, stopAt: 5 };

test('phase and cycle lengths', () => {
  expect(phaseLength([a])).toBe(26);
  expect(phaseLength([])).toBe(17);
  expect(cycleLength([[a], [a], []])).toBe(69);
});
