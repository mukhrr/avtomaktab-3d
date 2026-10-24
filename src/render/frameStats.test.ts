import { describe, expect, it } from 'vitest';
import { FrameStats } from './frameStats';

describe('FrameStats', () => {
  it('summary percentiles over a known sequence', () => {
    const s = new FrameStats();
    for (let i = 1; i <= 100; i++) s.add(i, null);
    const r = s.summary();
    expect(r.cpuP50).toBe(50);
    expect(r.cpuP95).toBe(95);
    expect(r.gpuP50).toBeNull();
    expect(r.gpuP95).toBeNull();
    expect(r.frames).toBe(100);
  });

  it('keeps only the last 300 frames', () => {
    const s = new FrameStats();
    for (let i = 1; i <= 400; i++) s.add(i, null);
    const r = s.summary();
    expect(r.frames).toBe(300);
    expect(r.cpuP50).toBe(250);
    expect(r.cpuP95).toBe(385);
  });

  it('gpu percentiles skip nulls', () => {
    const s = new FrameStats();
    for (let i = 1; i <= 10; i++) s.add(1, i % 2 ? null : i);
    const r = s.summary();
    expect(r.gpuP50).toBe(6);
    expect(r.gpuP95).toBe(10);
  });

  it('reset empties the window', () => {
    const s = new FrameStats();
    s.add(5, 5);
    s.reset();
    expect(s.summary()).toEqual({ cpuP50: 0, cpuP95: 0, gpuP50: null, gpuP95: null, frames: 0 });
  });
});
