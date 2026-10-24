import { FrameStats } from './frameStats';
import { createProbe, needsReload } from './probe';

function feed(frames: number, ms: number, dtMs = 16) {
  const stats = new FrameStats();
  const probe = createProbe(stats);
  let result = null;
  for (let i = 0; i < frames && !result; i++) {
    stats.add(ms, null);
    result = probe.frame(i * dtMs);
  }
  return result;
}

test('a fast machine finishes after 120 measured frames and picks high', () => {
  expect(feed(200, 3)).toBe('high');
});

test('a slow machine picks low', () => {
  expect(feed(200, 15)).toBe('low');
});

test('the first frames are warm-up and not measured', () => {
  const stats = new FrameStats();
  const probe = createProbe(stats);
  for (let i = 0; i < 10; i++) {
    stats.add(500, null);
    expect(probe.frame(i)).toBeNull();
  }
  for (let i = 10; i < 130; i++) {
    stats.add(3, null);
    probe.frame(i);
  }
  expect(stats.summary().cpuP95).toBe(3);
});

test('after 4 s it decides with at least 20 frames', () => {
  const stats = new FrameStats();
  const probe = createProbe(stats);
  let result = null;
  for (let i = 0; i < 60 && !result; i++) {
    stats.add(15, null);
    result = probe.frame(i * 100);
  }
  expect(result).toBe('low');
});

test('after 4 s with fewer than 20 frames it falls back to medium', () => {
  const stats = new FrameStats();
  const probe = createProbe(stats);
  let result = null;
  for (let i = 0; i < 15 && !result; i++) {
    stats.add(3, null);
    result = probe.frame(i * 1000);
  }
  expect(result).toBe('medium');
});

test('a reload is needed only when antialias or ground textures differ', () => {
  expect(needsReload('high', 'medium')).toBe(false);
  expect(needsReload('medium', 'low')).toBe(true);
  expect(needsReload('low', 'high')).toBe(true);
  expect(needsReload('low', 'low')).toBe(false);
});
