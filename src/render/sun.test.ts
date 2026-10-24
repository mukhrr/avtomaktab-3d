import { describe, expect, it } from 'vitest';
import { sunDirection, sunPosition } from './sun';

const LAT = 41.3111;
const LON = 69.2797;
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

describe('sunPosition', () => {
  it('summer solstice near solar noon is about 72 degrees up, due south', () => {
    const p = sunPosition(LAT, LON, new Date('2026-06-21T07:30:00Z'));
    expect(deg(p.elevation)).toBeGreaterThan(71);
    expect(deg(p.elevation)).toBeLessThan(73);
    expect(deg(p.azimuth)).toBeGreaterThan(170);
    expect(deg(p.azimuth)).toBeLessThan(190);
  });

  it('mid May 13:00 local is 60 to 70 degrees up', () => {
    const p = sunPosition(LAT, LON, new Date('2026-05-15T08:00:00Z'));
    expect(deg(p.elevation)).toBeGreaterThan(60);
    expect(deg(p.elevation)).toBeLessThan(70);
  });

  it('mid May 18:45 local is low in the west', () => {
    const p = sunPosition(LAT, LON, new Date('2026-05-15T13:45:00Z'));
    expect(deg(p.elevation)).toBeGreaterThan(2);
    expect(deg(p.elevation)).toBeLessThan(12);
    expect(deg(p.azimuth)).toBeGreaterThan(280);
    expect(deg(p.azimuth)).toBeLessThan(300);
  });
});

describe('sunDirection', () => {
  it('east at the horizon points along +x', () => {
    const d = sunDirection(0, rad(90));
    expect(d[0]).toBeCloseTo(1);
    expect(d[1]).toBeCloseTo(0);
    expect(d[2]).toBeCloseTo(0);
  });

  it('south at the horizon points along +z', () => {
    const d = sunDirection(0, rad(180));
    expect(d[0]).toBeCloseTo(0);
    expect(d[1]).toBeCloseTo(0);
    expect(d[2]).toBeCloseTo(1);
  });
});
