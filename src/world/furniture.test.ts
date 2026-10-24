import { readFileSync } from 'node:fs';
import type { DistrictData } from '../shared/district';
import { junctionPolygon, junctionTrim } from './roadGeometry';
import { FOOT_KINDS } from '../../tools/city/extract';
import { pointInPolygon, segmentDistance } from './spatial';
import { crossingFrame } from './streetside';
import { shelterBoxes, SHELTER_LENGTH } from './furniture';

const d: DistrictData = JSON.parse(readFileSync(new URL('../../public/districts/tashkent-center/district.json', import.meta.url), 'utf8'));
const edges = new Map(d.graph.edges.map(e => [e.id, e]));
const kind = new Map(d.roads.map(r => [r.id, r.kind]));
const drivable = d.graph.edges.filter(e => !FOOT_KINDS.has(kind.get(e.roadId) ?? ''));

const polygons = d.graph.nodes.flatMap(n => {
  const touching = n.edges.map(id => edges.get(id)!);
  return junctionTrim(n, touching).size ? [junctionPolygon(n, touching)] : [];
});
const frames = d.crossings.map(c => crossingFrame(c, edges.get(c.edgeId)!));

/** Metres from the point to the nearest drivable kerb, and the direction from the point to that road, as a heading. */
function nearestRoad(x: number, z: number): { clearance: number; toward: number } {
  let best = { clearance: Infinity, toward: 0 };
  for (const e of drivable)
    for (let i = 1; i < e.points.length; i++) {
      const { d: dist, t } = segmentDistance(x, z, e.points[i - 1], e.points[i]);
      if (dist - e.width / 2 >= best.clearance) continue;
      const a = e.points[i - 1], b = e.points[i];
      best = { clearance: dist - e.width / 2, toward: Math.atan2(a[0] + (b[0] - a[0]) * t - x, a[1] + (b[1] - a[1]) * t - z) };
    }
  return best;
}

const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('furniture on the real district', () => {
  it('has bus stops, benches and bins with unique ids', () => {
    for (const k of ['busStop', 'bench', 'bin'] as const) expect(d.furniture.filter(f => f.kind === k).length, k).toBeGreaterThan(5);
    expect(new Set(d.furniture.map(f => f.id)).size).toBe(d.furniture.length);
  });

  it('nothing lies in a carriageway, junction or crossing', () => {
    for (const f of d.furniture) {
      expect(nearestRoad(f.x, f.z).clearance, `${f.id} clearance`).toBeGreaterThanOrEqual(0);
      expect(polygons.some(p => pointInPolygon(f.x, f.z, p)), `${f.id} in junction`).toBe(false);
      expect(frames.some(fr => {
        const dx = f.x - fr.x, dz = f.z - fr.z;
        return Math.abs(dx * fr.tx + dz * fr.tz) <= fr.halfLength && Math.abs(dx * fr.tz - dz * fr.tx) <= fr.halfWidth;
      }), `${f.id} on crossing`).toBe(false);
    }
  });

  it('every bus stop is within 4 m of a kerb and faces the road within 15 degrees', () => {
    for (const f of d.furniture.filter(f => f.kind === 'busStop')) {
      const { clearance, toward } = nearestRoad(f.x, f.z);
      expect(clearance, f.id).toBeLessThanOrEqual(4);
      expect(angleBetween(f.heading, toward) * (180 / Math.PI), f.id).toBeLessThanOrEqual(15);
    }
  });

  it('the whole 4 m shelter stays off carriageways and junctions', () => {
    const boxes = shelterBoxes(d);
    expect(boxes.length).toBe(d.furniture.filter(f => f.kind === 'busStop').length);
    for (const b of boxes) {
      expect(b.halfLength * 2).toBe(SHELTER_LENGTH);
      for (const s of [-1, 0, 1]) {
        const x = b.x + Math.sin(b.heading + Math.PI / 2) * b.halfLength * s, z = b.z + Math.cos(b.heading + Math.PI / 2) * b.halfLength * s;
        expect(nearestRoad(x, z).clearance).toBeGreaterThan(0.5);
        expect(polygons.some(p => pointInPolygon(x, z, p))).toBe(false);
      }
    }
  });
});
