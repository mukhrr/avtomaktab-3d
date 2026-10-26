import { loadWorld, runExam } from './testDriver';

// One file per route so the runs go in parallel; traffic as main.ts sets it up.
it('a careful driver following the directions passes route-6 with M2 traffic', () => {
  const run = runExam(loadWorld({ cars: 60, crossers: 40, walkers: 80 }, 'route-6'), { indicators: true, obeyLights: true });
  expect(run.result.phase).toBe('finished');
  expect(run.result.passed).toBe(true);
  expect(run.result.violations.map(v => v.id).filter(id => id === 'noIndicator' || id === 'noMirrorCheck')).toEqual([]);
  expect(run.signalling).toEqual([]);
  expect(run.seconds).toBeLessThan(1500);
}, 120_000);
