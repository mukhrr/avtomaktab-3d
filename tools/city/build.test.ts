import { readFileSync } from 'node:fs';
import { buildDistrict } from './build';

const xml = readFileSync(new URL('./fixtures/mini.osm.xml', import.meta.url), 'utf8');
const config = { name: 'mini', bbox: [69.278, 41.31, 69.281, 41.312] as [number, number, number, number], origin: { lat: 41.3111, lon: 69.2797 } };
const d = buildDistrict(xml, config, { removeWays: [], roads: {}, buildingHeights: {} });

test('every graph edge belongs to an extracted road', () => {
  const roadIds = new Set(d.roads.map(r => r.id));
  expect(d.graph.edges.length).toBeGreaterThan(0);
  for (const e of d.graph.edges) expect(roadIds.has(e.roadId)).toBe(true);
});

test('bounds are the bbox in metres', () => {
  expect(d.bounds.minX).toBeLessThan(0);
  expect(d.bounds.maxX).toBeGreaterThan(0);
  expect(d.bounds.minZ).toBeLessThan(d.bounds.maxZ);
});

test('survives a JSON round trip unchanged', () => {
  expect(JSON.parse(JSON.stringify(d))).toEqual(d);
});
