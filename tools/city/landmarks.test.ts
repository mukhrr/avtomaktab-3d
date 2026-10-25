import { readFileSync } from 'node:fs';
import type { Building, DistrictData } from '../../src/shared/district';
import { segmentDistance } from '../../src/world/spatial';
import { crossingFrame } from '../../src/world/streetside';
import { extractLandmarks } from './landmarks';
import type { OsmData } from './osm';

const project = (lat: number, lon: number): [number, number] => [lon, -lat];
const node = (id: string, lat: number, lon: number) => [id, { id, lat, lon, tags: {} }] as const;
const osm: OsmData = {
  nodes: new Map([
    node('1', 0, 0), node('2', 0, 0), node('10', 0, 5), node('11', 0, -5), node('12', 5, 0), node('13', -5, 0),
    node('40', 0, 100), node('41', 0, 120), node('42', -20, 120), node('43', -20, 100),
  ]),
  ways: [
    { id: '20', nodeIds: ['10', '12', '11', '13', '10'], tags: {} },
    { id: '30', nodeIds: ['40', '41', '42', '43', '40'], tags: {} },
  ],
};
const building: Building = { id: '30', height: 40, levels: 10, style: 'tower', footprint: [[100, 0], [120, 0], [120, 20], [100, 20]] };

test('a node becomes the monument with its plinth radius, facing the square centre', () => {
  const [m] = extractLandmarks({ ...osm, nodes: new Map([node('1', -8, 5)]) }, project, { '1': 'amirTemur' }, []);
  expect(m).toMatchObject({ id: '1', kind: 'amirTemur', x: 5, z: 8, radius: 6 });
  expect(m.heading).toBeCloseTo(Math.atan2(-5, -8), 3);
});

test('a round way becomes a fountain at its centroid with a radius from its area, heading 0', () => {
  const [f] = extractLandmarks(osm, project, { '20': 'fountain' }, []);
  expect(f).toMatchObject({ id: '20', kind: 'fountain', heading: 0 });
  expect(f.x).toBeCloseTo(0, 3);
  expect(f.z).toBeCloseTo(0, 3);
  expect(f.radius).toBeCloseTo(Math.sqrt(50 / Math.PI), 2);
  expect(f.buildingId).toBeUndefined();
});

test('a building way carries the building id and footprint and faces the centre', () => {
  const [b] = extractLandmarks(osm, project, { '30': 'hotelUzbekistan' }, [building]);
  expect(b).toMatchObject({ id: '30', kind: 'hotelUzbekistan', buildingId: '30', footprint: building.footprint, x: 110, z: 10 });
  expect(b.heading).toBeCloseTo(Math.atan2(-110, -10), 3);
});

test('an anchor node gives a building landmark its anchor point', () => {
  const [b] = extractLandmarks(osm, project, { '30': 'kuranty' }, [building], { '30': '41' });
  expect(b.anchor).toEqual([120, -0]);
  expect(() => extractLandmarks(osm, project, { '30': 'kuranty' }, [building], { '30': '999' })).toThrow(/anchor node 999/);
});

test('an id missing from the OSM data or the buildings fails the build', () => {
  expect(() => extractLandmarks(osm, project, { '999': 'kuranty' }, [])).toThrow(/landmark 999/);
  expect(() => extractLandmarks(osm, project, { '30': 'kuranty' }, [])).toThrow(/landmark 30/);
});

const d: DistrictData = JSON.parse(readFileSync(new URL('../../public/districts/tashkent-center/district.json', import.meta.url), 'utf8'));

describe('tashkent-center', () => {
  it('has the six kinds, four of them fountains', () => {
    expect(new Set(d.landmarks.map(l => l.kind)).size).toBe(6);
    expect(d.landmarks.filter(l => l.kind === 'fountain')).toHaveLength(4);
    expect(d.landmarks).toHaveLength(9);
  });

  it('anchors the Kuranty tower on its clock node', () => {
    const k = d.landmarks.find(l => l.kind === 'kuranty')!;
    expect(k.anchor![0]).toBeCloseTo(5, 0);
    expect(k.anchor![1]).toBeCloseTo(164, 0);
    expect(d.landmarks.filter(l => l.anchor)).toHaveLength(1);
  });

  it('puts the hotel on its OSM building', () => {
    const hotel = d.landmarks.find(l => l.kind === 'hotelUzbekistan')!;
    expect(hotel.buildingId).toBe('44491343');
    expect(hotel.footprint).toEqual(d.buildings.find(b => b.id === '44491343')!.footprint);
  });

  it('keeps free-standing landmarks 3 m off every carriageway and crossing', () => {
    const kind = new Map(d.roads.map(r => [r.id, r.kind]));
    const free = d.landmarks.filter(l => !l.buildingId);
    expect(free.length).toBe(5);
    for (const l of free) {
      for (const e of d.graph.edges) {
        if (['footway', 'path', 'pedestrian', 'steps', 'cycleway'].includes(kind.get(e.roadId) ?? '')) continue;
        for (let i = 1; i < e.points.length; i++) {
          const gap = segmentDistance(l.x, l.z, e.points[i - 1], e.points[i]).d - e.width / 2;
          expect(gap, `${l.id} to ${e.id}`).toBeGreaterThanOrEqual(3);
        }
      }
      for (const c of d.crossings) {
        const f = crossingFrame(c, d.graph.edges.find(e => e.id === c.edgeId)!);
        const dx = l.x - f.x, dz = l.z - f.z;
        const gap = Math.hypot(Math.max(Math.abs(dx * f.tx + dz * f.tz) - f.halfLength, 0), Math.max(Math.abs(dx * f.tz - dz * f.tx) - f.halfWidth, 0));
        expect(gap, `${l.id} to crossing ${c.id}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
