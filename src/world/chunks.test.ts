import type { Vec2 } from '../shared/district';
import { chunkKey, groupByChunk } from './chunks';

test('points either side of a chunk edge get different keys', () => {
  expect(chunkKey(199, 0)).not.toBe(chunkKey(201, 0));
  expect(chunkKey(0, 0)).not.toBe(chunkKey(201, 0));
  expect(chunkKey(0, 0)).toBe(chunkKey(199, 199));
  expect(chunkKey(-1, 0)).not.toBe(chunkKey(1, 0));
});

test('every item lands in exactly one chunk', () => {
  const pts: Vec2[] = [];
  for (let i = 0; i < 500; i++) pts.push([Math.sin(i) * 900, Math.cos(i * 1.7) * 800]);
  const groups = groupByChunk(pts, p => p);
  const all = [...groups.values()].flat();
  expect(all).toHaveLength(pts.length);
  expect(new Set(all)).toEqual(new Set(pts));
  for (const [key, items] of groups) for (const p of items) expect(chunkKey(p[0], p[1])).toBe(key);
});

test('size changes the grid', () => {
  expect(chunkKey(250, 0, 400)).toBe(chunkKey(10, 0, 400));
  expect(groupByChunk<Vec2>([[0, 0], [250, 0]], p => p, 400).size).toBe(1);
});
