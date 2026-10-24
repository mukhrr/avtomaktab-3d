import { afterProbe, createProbe, needsReload } from './probe';

function run(frames: number, render: (i: number) => number, dtMs = 16, steps: (i: number) => number = () => 1) {
  const probe = createProbe();
  let result = null;
  for (let i = 0; i < frames && !result; i++) result = probe.frame(i * dtMs, render(i), null, steps(i));
  return result;
}

test('a fast machine finishes after 120 measured frames and picks high', () => {
  expect(run(200, () => 3)).toEqual({ quality: 'high', measured: true });
});

test('a slow machine picks low', () => {
  expect(run(200, () => 15)?.quality).toBe('low');
});

test('the first 10 frames are warm-up', () => {
  expect(run(200, i => (i < 10 ? 500 : 3))?.quality).toBe('high');
});

test('frames with catch-up sim steps are skipped', () => {
  expect(run(400, i => (i % 2 ? 80 : 3), 16, i => (i % 2 ? 4 : 1))?.quality).toBe('high');
});

test('a few hitches do not lower the preset', () => {
  expect(run(300, i => (i % 25 === 0 ? 60 : 3))?.quality).toBe('high');
});

test('after 4 s it decides with at least 20 frames', () => {
  expect(run(60, () => 15, 100)).toEqual({ quality: 'low', measured: true });
});

test('after 4 s with fewer than 20 frames it falls back to unmeasured medium', () => {
  expect(run(15, () => 3, 1000)).toEqual({ quality: 'medium', measured: false });
});

test('a reload is needed only when antialias or ground textures differ', () => {
  expect(needsReload('high', 'medium')).toBe(false);
  expect(needsReload('medium', 'low')).toBe(true);
  expect(needsReload('low', 'high')).toBe(true);
  expect(needsReload('low', 'low')).toBe(false);
});

test('a measured pick that needs other load-time settings reloads; anything else applies in place', () => {
  expect(afterProbe('medium', { quality: 'low', measured: true })).toBe('reload');
  expect(afterProbe('medium', { quality: 'high', measured: true })).toBe('apply');
  expect(afterProbe('medium', { quality: 'medium', measured: false })).toBe('apply');
});
