import { readFileSync } from 'node:fs';
import { parseOsm } from './osm';
import { makeProjection } from './projection';
import { extractFeatures, signedArea, type Overrides } from './extract';

const xml = readFileSync(new URL('./fixtures/mini.osm.xml', import.meta.url), 'utf8');
const project = makeProjection({ lat: 41.3111, lon: 69.2797 });
const none: Overrides = { removeWays: [], roads: {}, buildingHeights: {}, buildingStyles: {} };
const run = (overrides = none, osm = parseOsm(xml)) => extractFeatures(osm, project, overrides);

test('oneway primary gets kind defaults', () => {
  const r = run().roads.find(r => r.id === '102');
  expect(r).toMatchObject({ oneway: true, width: 12, maxspeed: 60, lanes: 3, name: "Bosh yo'l" });
});

test('integer lanes widen the road to lanes x 3.5', () => {
  expect(run().roads.find(r => r.id === '100')?.width).toBe(7);
});

test('unparsable lanes and height fall back to defaults', () => {
  const f = run();
  expect(f.roads.find(r => r.id === '101')?.width).toBe(6);
  const h = f.buildings.find(b => b.id === '106')?.height;
  expect(h).toBeGreaterThanOrEqual(8);
  expect(h).toBeLessThanOrEqual(8 + 4 * 3.2);
});

test('building height comes from levels and footprint is counter-clockwise without closing point', () => {
  const b = run().buildings.find(b => b.id === '103')!;
  expect(b.height).toBeCloseTo(12.8);
  expect(b.footprint).toHaveLength(4);
  expect(signedArea(b.footprint)).toBeGreaterThan(0);
});

test('clockwise input footprint is rewound counter-clockwise', () => {
  const osm = parseOsm(xml);
  const w = osm.ways.find(w => w.id === '103')!;
  w.nodeIds.reverse();
  expect(signedArea(run(none, osm).buildings.find(b => b.id === '103')!.footprint)).toBeGreaterThan(0);
});

test('ways with unresolved nodes are skipped', () => {
  expect(run().roads.find(r => r.id === '105')).toBeUndefined();
});

test('overrides change lanes, heights and remove ways', () => {
  const f = run({ removeWays: ['100'], roads: { '101': { lanes: 3 } }, buildingHeights: { '103': 40 }, buildingStyles: { '103': 'tower' } });
  expect(f.roads.find(r => r.id === '100')).toBeUndefined();
  expect(f.roads.find(r => r.id === '101')?.width).toBe(10.5);
  expect(f.buildings.find(b => b.id === '103')?.height).toBe(40);
});

test('green areas and signals are extracted', () => {
  const f = run();
  expect(f.areas).toEqual([expect.objectContaining({ id: '104', kind: 'green' })]);
  expect(f.signals.map(s => s.id)).toEqual(['16', '18']);
});

test('road node ids are kept in order for the graph builder', () => {
  expect(run().roadNodeIds.get('101')).toEqual(['4', '2', '5']);
});

test('crossing nodes on car roads are extracted with a kind', () => {
  expect(run().crossingNodes).toEqual([{ id: '17', kind: 'zebra' }]);
});

test('crossing tags map to signal, zebra or unmarked; nodes off car roads are dropped', () => {
  const osm = parseOsm(xml);
  const cross = (id: string, tags: Record<string, string>) =>
    osm.nodes.set(id, { id, lat: 41.311, lon: 69.2785, tags: { highway: 'crossing', ...tags } });
  cross('17', { crossing: 'traffic_signals;marked' });
  cross('20', { crossing: 'marked' });
  cross('21', { crossing: 'uncontrolled' });
  cross('22', { crossing: 'unmarked' });
  cross('23', {});
  cross('24', { crossing: 'zebra' });
  osm.ways.find(w => w.id === '100')!.nodeIds.push('20', '21', '22', '23');
  const kinds = Object.fromEntries(run(none, osm).crossingNodes.map(c => [c.id, c.kind]));
  expect(kinds).toEqual({ '17': 'signal', '20': 'zebra', '21': 'zebra', '22': 'unmarked', '23': 'unmarked' });
});

test('buildings carry levels and a classified style, and an override wins', () => {
  const f = run();
  const b = f.buildings.find(b => b.id === '103')!;
  expect(b.levels).toBe(4);
  expect(b.style).toBe('stucco');
  const o = run({ ...none, buildingStyles: { '103': 'tower' } });
  expect(o.buildings.find(b => b.id === '103')?.style).toBe('tower');
});

test('roof:shape hipped and gabled are kept, other shapes dropped', () => {
  const osm = parseOsm(xml);
  const w = osm.ways.find(w => w.id === '103')!;
  w.tags['roof:shape'] = 'hipped';
  expect(run(none, osm).buildings.find(b => b.id === '103')?.roof).toBe('hipped');
  w.tags['roof:shape'] = 'skillion';
  expect(run(none, osm).buildings.find(b => b.id === '103')?.roof).toBeUndefined();
});
