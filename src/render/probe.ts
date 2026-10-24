import { pickQuality, QUALITY, type Quality } from './quality';

const WARMUP_FRAMES = 10;
const TARGET_SAMPLES = 120;
export const PROBE_MIN_FRAMES = 20;
const MAX_MS = 4000;

const p90 = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.9 * v.length) - 1)];

export interface ProbeResult {
  quality: Quality;
  /** False when too few frames arrived in time to say anything about the machine. */
  measured: boolean;
}

/**
 * Samples are render-only times. The first frames (shader compiles) and frames that ran catch-up
 * sim steps are skipped, and p90 rather than p95 is used so a stray hitch cannot lower the preset.
 */
export function createProbe() {
  let startMs: number | null = null;
  let seen = 0;
  const cpu: number[] = [];
  const gpu: number[] = [];
  return {
    frame(nowMs: number, renderCpuMs: number, gpuMs: number | null, simSteps: number): ProbeResult | null {
      startMs ??= nowMs;
      seen++;
      if (seen > WARMUP_FRAMES && simSteps <= 1) {
        cpu.push(renderCpuMs);
        if (gpuMs !== null) gpu.push(gpuMs);
      }
      const timedOut = nowMs - startMs >= MAX_MS;
      if (cpu.length < TARGET_SAMPLES && !timedOut) return null;
      if (cpu.length < PROBE_MIN_FRAMES) return { quality: 'medium', measured: false };
      return { quality: pickQuality(gpu.length ? p90(gpu) : null, p90(cpu)), measured: true };
    },
  };
}

/** Antialiasing and ground textures are fixed for the page load. */
export function needsReload(loaded: Quality, chosen: Quality): boolean {
  return QUALITY[loaded].antialias !== QUALITY[chosen].antialias || QUALITY[loaded].groundTextures !== QUALITY[chosen].groundTextures;
}
