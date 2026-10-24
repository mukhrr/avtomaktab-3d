import { readFileSync } from 'node:fs';
import type { DistrictData } from '../shared/district';
import { waterAreas } from './buildWorld';

const d: DistrictData = JSON.parse(readFileSync('public/districts/tashkent-center/district.json', 'utf8'));

test('fountain basins draw their own water, so their OSM water areas are left out', () => {
  const fountains = new Set(d.landmarks.filter(l => l.kind === 'fountain').map(l => l.id));
  const ids = waterAreas(d).map(a => a.id);
  expect(fountains.size).toBe(4);
  expect(ids.some(id => fountains.has(id))).toBe(false);
  expect(ids.length).toBe(d.areas.filter(a => a.kind === 'water').length - 4);
});
