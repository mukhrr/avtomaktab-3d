export type Quality = 'low' | 'medium' | 'high';

export interface QualitySettings {
  pixelRatioCap: number;
  antialias: boolean;
  cascades: 1 | 2 | 3;
  shadowMapSize: 1024 | 2048;
  shadowFar: number;
  mirrorSize: [number, number];
  mirrorEvery: 1 | 2 | 3;
  groundTextures: boolean;
  /** Image-based ambient light from the sky on every lit material; low stays on M3's Lambert and hemisphere. */
  skyAmbient: boolean;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  low: {
    pixelRatioCap: 1,
    antialias: false,
    cascades: 1,
    shadowMapSize: 1024,
    shadowFar: 150,
    mirrorSize: [128, 64],
    mirrorEvery: 3,
    groundTextures: false,
    skyAmbient: false,
  },
  medium: {
    pixelRatioCap: 1.5,
    antialias: true,
    cascades: 2,
    shadowMapSize: 2048,
    shadowFar: 300,
    mirrorSize: [256, 128],
    mirrorEvery: 2,
    groundTextures: true,
    skyAmbient: true,
  },
  high: {
    pixelRatioCap: 2,
    antialias: true,
    cascades: 3,
    shadowMapSize: 2048,
    shadowFar: 450,
    mirrorSize: [256, 128],
    mirrorEvery: 2,
    groundTextures: true,
    skyAmbient: true,
  },
};

/** Inputs are p90 render-only frame times (ms) measured at medium. */
export function pickQuality(probeGpuMs: number | null, probeCpuMs: number): Quality {
  const worst = probeGpuMs === null ? probeCpuMs : Math.max(probeGpuMs, probeCpuMs);
  if (worst <= 5) return 'high';
  if (worst <= 10) return 'medium';
  return 'low';
}

const KEY = 'avtomaktab.quality';

export function loadQuality(): Quality | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : null;
  } catch {
    return null;
  }
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // Storage blocked: the choice is only kept for this visit.
  }
}
