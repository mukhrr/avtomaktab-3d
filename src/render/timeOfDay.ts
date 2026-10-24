export type TimeOfDay = 'morning' | 'noon' | 'evening';

export interface LightPreset {
  utc: string;
  sunColor: number;
  sunIntensity: number;
  skyColor: number;
  groundColor: number;
  hemiIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  exposure: number;
  turbidity: number;
  rayleigh: number;
}

// 2026-05-15 in Tashkent (UTC+5): 08:30, 13:00 and 18:00 local.
export const TIMES_OF_DAY: Record<TimeOfDay, LightPreset> = {
  morning: {
    utc: '2026-05-15T03:30:00Z',
    sunColor: 0xffe6c4,
    sunIntensity: 2.4,
    skyColor: 0xa9c8ea,
    groundColor: 0x8a7f70,
    hemiIntensity: 0.85,
    fogColor: 0xcfdbe8,
    fogNear: 120,
    fogFar: 650,
    exposure: 0.55,
    turbidity: 5,
    rayleigh: 1.6,
  },
  noon: {
    utc: '2026-05-15T08:00:00Z',
    sunColor: 0xfff4e0,
    sunIntensity: 3.2,
    skyColor: 0x9cc4f0,
    groundColor: 0x9a9082,
    hemiIntensity: 1.0,
    fogColor: 0xc8d9ec,
    fogNear: 150,
    fogFar: 800,
    exposure: 0.5,
    turbidity: 4,
    rayleigh: 1.2,
  },
  evening: {
    utc: '2026-05-15T13:00:00Z',
    sunColor: 0xffa860,
    sunIntensity: 2.6,
    skyColor: 0xb8bcc8,
    groundColor: 0x7a6656,
    hemiIntensity: 1.1,
    fogColor: 0xe6b48c,
    fogNear: 90,
    fogFar: 500,
    exposure: 0.6,
    turbidity: 8,
    rayleigh: 2.4,
  },
};
