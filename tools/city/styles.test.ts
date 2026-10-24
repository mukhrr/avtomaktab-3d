import { describe, expect, it } from 'vitest';
import { classifyBuilding, levelsFor, minAreaRect } from './styles';

const base = { tags: { building: 'yes' }, height: 9.6, footprintArea: 300, longSide: 20, shortSide: 15 };
const style = (over: Partial<typeof base> & { building?: string; extra?: Record<string, string> }) => {
  const { building, extra, ...rest } = over;
  return classifyBuilding({ ...base, ...rest, tags: { building: building ?? 'yes', ...extra } });
};

describe('classifyBuilding', () => {
  it.each(['garages', 'garage', 'roof', 'carport', 'guardhouse', 'shed', 'kiosk'])('%s is shed', b => {
    expect(style({ building: b })).toBe('shed');
  });

  it.each(['university', 'school', 'kindergarten', 'civic', 'museum', 'government', 'hospital', 'public'])('%s is public', b => {
    expect(style({ building: b })).toBe('public');
  });

  it('amenity or office tag makes a building public', () => {
    expect(style({ extra: { amenity: 'bank' } })).toBe('public');
    expect(style({ extra: { office: 'company' } })).toBe('public');
  });

  it('shed beats public', () => {
    expect(style({ building: 'garages', extra: { amenity: 'parking' } })).toBe('shed');
  });

  it('40 m or taller is a tower', () => {
    expect(style({ height: 40 })).toBe('tower');
    expect(style({ height: 39.9, longSide: 20, shortSide: 15 })).not.toBe('tower');
  });

  it('public beats tower', () => {
    expect(style({ building: 'university', height: 60 })).toBe('public');
  });

  it('tall apartments and residential are panel', () => {
    expect(style({ building: 'apartments', height: 16 })).toBe('panel');
    expect(style({ building: 'residential', height: 32 })).toBe('panel');
    expect(style({ building: 'apartments', height: 9.6 })).not.toBe('panel');
  });

  it('an untagged slab of 5 to 16 levels is panel', () => {
    expect(style({ height: 28.8, longSide: 60, shortSide: 12 })).toBe('panel');
  });

  it('an untagged block that is not slab-shaped is not panel', () => {
    expect(style({ height: 28.8, longSide: 30, shortSide: 20, footprintArea: 600 })).toBe('stucco');
    expect(style({ height: 28.8, longSide: 60, shortSide: 19 })).toBe('stucco');
  });

  it('low small buildings are brick', () => {
    expect(style({ height: 9.6, footprintArea: 600 })).toBe('brick');
    expect(style({ height: 9.6, footprintArea: 601 })).toBe('stucco');
    expect(style({ height: 12.8 })).toBe('stucco');
  });

  it('everything else is stucco', () => {
    expect(style({ building: 'commercial', height: 19.2, footprintArea: 1500 })).toBe('stucco');
  });
});

describe('levelsFor', () => {
  it('rounds height over 3.2 and never goes below 1', () => {
    expect(levelsFor(3)).toBe(1);
    expect(levelsFor(9.6)).toBe(3);
    expect(levelsFor(88)).toBe(28);
    expect(levelsFor(1)).toBe(1);
  });
});

describe('minAreaRect', () => {
  it('finds 60 x 12 for a rotated rectangle', () => {
    const a = 0.6;
    const pts: [number, number][] = [[0, 0], [60, 0], [60, 12], [0, 12]].map(([x, z]) => [
      100 + x * Math.cos(a) - z * Math.sin(a),
      50 + x * Math.sin(a) + z * Math.cos(a),
    ]);
    const { longSide, shortSide } = minAreaRect(pts);
    expect(longSide).toBeCloseTo(60, 2);
    expect(shortSide).toBeCloseTo(12, 2);
  });
});
