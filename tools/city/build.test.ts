import { readFileSync } from 'node:fs';
import type { DistrictData, Sign } from '../../src/shared/district';
import { CODE } from '../../src/shared/signCatalogue';
import { edgeLength } from './attach';
import { buildDistrict, validateSigns } from './build';

const xml = readFileSync(new URL('./fixtures/mini.osm.xml', import.meta.url), 'utf8');
const config = { name: 'mini', bbox: [69.278, 41.31, 69.281, 41.312] as [number, number, number, number], origin: { lat: 41.3111, lon: 69.2797 } };
const d = buildDistrict(xml, config, { removeWays: [], roads: {}, buildingHeights: {}, buildingStyles: {} });

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

test('zebra node on way 100 becomes a crossing on edge 100:0', () => {
  const c = d.crossings.find(c => c.id === '17')!;
  const e = d.graph.edges.find(e => e.id === '100:0')!;
  expect(c).toMatchObject({ kind: 'zebra', edgeId: '100:0', width: 7 });
  expect(c.at).toBeGreaterThan(0);
  expect(c.at).toBeLessThan(edgeLength(e));
  expect(c.position).toEqual(e.points[e.nodeIds.indexOf('17')]);
});

describe('signs', () => {
  const edge = d.graph.edges.find(e => e.lanesBackward === 0)!;
  const len = edgeLength(edge);
  const build = (...signs: Sign[]) => buildDistrict(xml, config, { removeWays: [], roads: {}, buildingHeights: {}, buildingStyles: {} }, signs);
  const sign = (extra: Partial<Sign>): Sign => ({ id: 's1', code: CODE.giveWay, edgeId: edge.id, dir: 1, at: 5, origin: 'hand', ...extra });

  it('defaults to no signs', () => {
    expect(d.signs).toEqual([]);
  });

  it('keeps valid signs in the district', () => {
    expect(build(sign({}), sign({ id: 's2', at: len })).signs.map(s => s.id)).toEqual(['s1', 's2']);
  });

  it('rejects a sign on a missing edge', () => {
    expect(() => build(sign({ edgeId: 'nope:0' }))).toThrow(/s1.*nope:0/);
  });

  it('rejects a sign placed beyond the edge', () => {
    expect(() => build(sign({ at: len + 1 }))).toThrow(/s1.*along/);
    expect(() => build(sign({ at: -1 }))).toThrow(/s1.*along/);
  });

  it('rejects a sign for a direction without lanes', () => {
    expect(() => build(sign({ dir: -1 }))).toThrow(/s1.*direction/);
  });

  it('rejects duplicate ids and a speed limit without a value', () => {
    expect(() => build(sign({}), sign({ at: 6 }))).toThrow(/duplicate/);
    expect(() => build(sign({ code: CODE.speedLimit }))).toThrow(/s1.*value/);
  });

  it('rejects a sign whose code is not in the catalogue', () => {
    expect(() => build(sign({ code: '9.99' }))).toThrow('9.99');
  });

  it('rejects a value sign without a value', () => {
    expect(() => build(sign({ code: '3.24' }))).toThrow('value');
  });

  it('takes a number for a speed and a string for a time', () => {
    expect(() => build(sign({ code: '3.24', value: '60' }))).toThrow('numeric');
    expect(() => build(sign({ code: '3.24', value: 60 }))).not.toThrow();
    expect(() => build(sign({ plates: [{ code: '7.5.4', value: 8 }] }))).toThrow('text');
    expect(() => build(sign({ plates: [{ code: '7.5.4', value: '8-19' }] }))).not.toThrow();
  });

  it('rejects a plate that is not in group 7', () => {
    expect(() => build(sign({ plates: [{ code: '2.5' }] }))).toThrow('plate');
  });

  it('accepts the migrated tashkent-center signs', () => {
    const dir = 'data/districts/tashkent-center';
    const real = JSON.parse(readFileSync(`${dir}/signs.json`, 'utf8')) as Sign[];
    const district = JSON.parse(readFileSync('public/districts/tashkent-center/district.json', 'utf8')) as DistrictData;
    expect(() => validateSigns(real, district.graph.edges)).not.toThrow();
  });
});
