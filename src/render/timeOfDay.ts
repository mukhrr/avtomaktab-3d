export type TimeOfDay = 'morning' | 'noon' | 'evening';

export interface LightPreset {
  utc: string;
  sunColor: number;
  sunIntensity: number;
  skyColor: number;
  groundColor: number;
  hemiIntensity: number;
  /** Hemisphere intensity on presets without sky ambient (low), where it is the only fill light. */
  hemiWithoutSky: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  exposure: number;
  turbidity: number;
  rayleigh: number;
  mie: number;
  skySaturation: number;
  /** Brightness of the visible sky only; ambient light uses the sky at gain 1. */
  skyGain: number;
  /** Scales the sky's image-based ambient light on lit materials. */
  envIntensity: number;
}

// 2026-05-15 in Tashkent (UTC+5): 08:30, 13:00 and 18:00 local.
export const TIMES_OF_DAY: Record<TimeOfDay, LightPreset> = {
  morning: {
    utc: '2026-05-15T03:30:00Z',
    sunColor: 0xffe6c4,
    sunIntensity: 2.4,
    skyColor: 0xa9c8ea,
    groundColor: 0x8a7f70,
    hemiIntensity: 0.5,
    hemiWithoutSky: 4,
    fogColor: 0xcfdbe8,
    fogNear: 120,
    fogFar: 650,
    exposure: 0.55,
    turbidity: 2,
    rayleigh: 2.5,
    mie: 0.002,
    skySaturation: 1.6,
    skyGain: 0.6,
    envIntensity: 0.35,
  },
  noon: {
    utc: '2026-05-15T08:00:00Z',
    sunColor: 0xfff4e0,
    sunIntensity: 2.8,
    skyColor: 0xd6e6f5,
    groundColor: 0xa08c6c,
    hemiIntensity: 0.5,
    hemiWithoutSky: 4,
    fogColor: 0xb6d1e6,
    fogNear: 300,
    fogFar: 1400,
    exposure: 0.5,
    turbidity: 1.5,
    rayleigh: 2.5,
    mie: 0.002,
    skySaturation: 2.4,
    skyGain: 0.5,
    envIntensity: 0.35,
  },
  evening: {
    utc: '2026-05-15T13:00:00Z',
    sunColor: 0xffa860,
    sunIntensity: 2.2,
    skyColor: 0xd8b89a,
    groundColor: 0x8a6a50,
    hemiIntensity: 1.5,
    hemiWithoutSky: 3.5,
    fogColor: 0xe6b48c,
    fogNear: 90,
    fogFar: 500,
    exposure: 0.6,
    turbidity: 8,
    rayleigh: 2.4,
    mie: 0.005,
    skySaturation: 1.3,
    skyGain: 0.85,
    envIntensity: 0.5,
  },
};
