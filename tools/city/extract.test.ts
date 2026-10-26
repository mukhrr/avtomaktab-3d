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

test('a bus stop, a bench and a bin node become three furniture items of their kinds', () => {
  const f = run().furniture;
  expect(f.map(i => [i.id, i.kind])).toEqual([['30', 'busStop'], ['31', 'bench'], ['32', 'bin']]);
  expect(f[0].position).toEqual(project(41.3117, 69.2785));
});

test('extracts schools, kindergartens, car parks and hospitals as POIs at their centroid', () => {
  const { pois } = run();
  expect(pois).toHaveLength(2);
  const school = pois.find(p => p.kind === 'school')!;
  const [lat, lon] = [(41.3101 + 41.3103) / 2, (69.2781 + 69.2785) / 2];
  const [x, z] = project(lat, lon);
  expect(school.id).toBe('107');
  expect(school.position[0]).toBeCloseTo(x, 1);
  expect(school.position[1]).toBeCloseTo(z, 1);
  expect(pois.find(p => p.kind === 'parking')).toMatchObject({ id: '44', position: project(41.3114, 69.2796) });
});

test('a POI way that is also a building stays a building', () => {
  const osm = parseOsm(xml);
  osm.ways.find(w => w.id === '103')!.tags.amenity = 'hospital';
  const f = run(none, osm);
  expect(f.pois.find(p => p.id === '103')?.kind).toBe('hospital');
  expect(f.buildings.some(b => b.id === '103')).toBe(true);
});

test('a living street is 20 km/h at most, as clause 78 sets for a residential zone', () => {
  const osm = parseOsm(xml);
  const w = osm.ways.find(w => w.id === '100')!;
  w.tags = { ...w.tags, highway: 'living_street', maxspeed: '40' };
  expect(run(none, osm).roads.find(r => r.id === '100')?.maxspeed).toBe(20);
  w.tags = { ...w.tags, maxspeed: '10' };
  expect(run(none, osm).roads.find(r => r.id === '100')?.maxspeed).toBe(10);
});
