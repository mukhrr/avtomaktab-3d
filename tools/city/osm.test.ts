import { readFileSync } from 'node:fs';
import { parseOsm } from './osm';

const xml = readFileSync(new URL('./fixtures/mini.osm.xml', import.meta.url), 'utf8');
const osm = parseOsm(xml);

test('parses all nodes with numeric coordinates', () => {
  expect(osm.nodes.size).toBe(16);
  expect(osm.nodes.get('2')).toMatchObject({ lat: 41.311, lon: 69.279 });
});

test('reads way tags', () => {
  expect(osm.ways.find(w => w.id === '103')?.tags['building:levels']).toBe('4');
});

test('a node with a single tag still gets a tags object', () => {
  expect(osm.nodes.get('16')?.tags).toEqual({ highway: 'traffic_signals' });
  expect(osm.nodes.get('1')?.tags).toEqual({});
});

test('keeps ways with unresolved or few nodes for the extractor to filter', () => {
  expect(osm.ways.find(w => w.id === '105')?.nodeIds).toEqual(['1', '999']);
});
