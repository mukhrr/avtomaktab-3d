import { pickQuality, QUALITY, type Quality } from './quality';
import type { FrameStats } from './frameStats';

const WARMUP_FRAMES = 10;
const TARGET_FRAMES = 120;
export const PROBE_MIN_FRAMES = 20;
const MAX_MS = 4000;

/** Shader compiles make the first frames unrepresentative, so they are dropped before measuring. */
export function createProbe(stats: FrameStats) {
  let startMs: number | null = null;
  let seen = 0;
  return {
    /** Call once per frame after the frame's sample was added to `stats`. Returns the pick when done. */
    frame(nowMs: number): Quality | null {
      startMs ??= nowMs;
      seen++;
      if (seen === WARMUP_FRAMES) stats.reset();
      const measured = Math.max(0, seen - WARMUP_FRAMES);
      const timedOut = nowMs - startMs >= MAX_MS;
      if (measured < TARGET_FRAMES && !timedOut) return null;
      if (measured < PROBE_MIN_FRAMES) return 'medium';
      const s = stats.summary();
      return pickQuality(s.gpuP95, s.cpuP95);
    },
  };
}

/** Antialiasing and ground textures are fixed for the page load. */
export function needsReload(loaded: Quality, chosen: Quality): boolean {
  return QUALITY[loaded].antialias !== QUALITY[chosen].antialias || QUALITY[loaded].groundTextures !== QUALITY[chosen].groundTextures;
}
