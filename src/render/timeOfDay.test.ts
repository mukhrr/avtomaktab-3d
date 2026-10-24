import { describe, expect, it } from 'vitest';
import { sunPosition } from './sun';
import { TIMES_OF_DAY, type TimeOfDay } from './timeOfDay';

const LAT = 41.3111;
const LON = 69.2797;
const elevation = (t: TimeOfDay) => sunPosition(LAT, LON, new Date(TIMES_OF_DAY[t].utc)).elevation;

describe('TIMES_OF_DAY', () => {
  it('has the sun above the horizon in every preset', () => {
    for (const t of Object.keys(TIMES_OF_DAY) as TimeOfDay[]) {
      expect(elevation(t)).toBeGreaterThan(0);
    }
  });

  it('evening sun is lower than morning and noon', () => {
    expect(elevation('evening')).toBeLessThan(elevation('morning'));
    expect(elevation('evening')).toBeLessThan(elevation('noon'));
  });

  it('evening is warmer than noon (more red than blue)', () => {
    const rb = (c: number) => (c >> 16) / ((c & 0xff) || 1);
    expect(rb(TIMES_OF_DAY.evening.sunColor)).toBeGreaterThan(rb(TIMES_OF_DAY.noon.sunColor));
  });
});
