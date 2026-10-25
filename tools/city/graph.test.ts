import { readFileSync } from 'node:fs';
import { parseOsm } from './osm';
import { makeProjection } from './projection';
import { extractFeatures } from './extract';
import { buildRoadGraph } from './graph';

const osm = parseOsm(readFileSync(new URL('./fixtures/mini.osm.xml', import.meta.url), 'utf8'));
const proj = makeProjection({ lat: 41.3111, lon: 69.2797 });
const f = extractFeatures(osm, proj, { removeWays: [], roads: {}, buildingHeights: {}, buildingStyles: {} });
const nodePos = (id: string) => { const n = osm.nodes.get(id)!; return proj(n.lat, n.lon); };
const g = buildRoadGraph(f.roads, f.roadNodeIds, nodePos);

test('crossing residential roads share one junction with 4 edges', () => {
  expect(g.nodes.find(n => n.id === '2')?.edges).toHaveLength(4);
});

test('way endpoints become nodes, unshared interior nodes do not', () => {
  expect(g.nodes.map(n => n.id).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7']);
});

test('oneway road has no backward lanes', () => {
  const e = g.edges.filter(e => e.roadId === '102');
  expect(e).toHaveLength(1);
  expect(e[0]).toMatchObject({ lanesForward: 3, lanesBackward: 0, id: '102:0' });
});

test('2-lane two-way road splits lanes 1 and 1', () => {
  expect(g.edges.find(e => e.roadId === '100')).toMatchObject({ lanesForward: 1, lanesBackward: 1 });
});

test('edge end points equal their node positions', () => {
  const byId = new Map(g.nodes.map(n => [n.id, n]));
  for (const e of g.edges) {
    expect(e.points[0]).toEqual(byId.get(e.from)!.position);
    expect(e.points.at(-1)).toEqual(byId.get(e.to)!.position);
  }
});

test('every edge has one OSM node id per point', () => {
  for (const e of g.edges) expect(e.nodeIds).toHaveLength(e.points.length);
  expect(g.edges.find(e => e.id === '100:0')!.nodeIds).toEqual(['1', '17', '2']);
});

test('keeps the road kind on every graph edge', () => {
  expect(g.edges.find(e => e.roadId === '102')!.kind).toBe('primary');
  expect(g.edges.find(e => e.roadId === '100')!.kind).toBe('residential');
});
