import { readFileSync } from 'node:fs';
import type { DistrictData, GraphEdge, Vec2 } from '../shared/district';
import { junctionPolygon, junctionTrim } from './roadGeometry';
import { signalPose } from './signals';
import { signPose } from './signs';
import { Grid, pointInPolygon, segmentDistance } from './spatial';
import { aryks, arykGeometry, crossingFrame, lampGeometry, lampPositions, LAMP_SEED } from './streetside';
import { TREE_SEED, treePositions } from './vegetation';
import { pointInShelter } from '../shared/shelter';

const d: DistrictData = JSON.parse(readFileSync(new URL('../../public/districts/tashkent-center/district.json', import.meta.url), 'utf8'));
const edges = new Map(d.graph.edges.map(e => [e.id, e]));
const roads = new Map(d.roads.map(r => [r.id, r]));
const AVENUE = new Set(['primary', 'secondary', 'tertiary']);

const polygons = d.graph.nodes.flatMap(n => {
  const touching = n.edges.map(id => edges.get(id)!);
  return junctionTrim(n, touching).size ? [junctionPolygon(n, touching)] : [];
});

function onCarriageway([x, z]: Vec2): boolean {
  return d.graph.edges.some(e => e.points.some((p, i) => i > 0 && segmentDistance(x, z, e.points[i - 1], p).d <= e.width / 2));
}
const inJunction = ([x, z]: Vec2) => polygons.some(p => pointInPolygon(x, z, p));

/** Metres from the crossing strip (3 m long, kerb to kerb plus 3 m of pavement each side), 0 inside. */
const frames = d.crossings.map(c => crossingFrame(c, edges.get(c.edgeId)!));
function crossingGap([x, z]: Vec2): number {
  let best = Infinity;
  for (const f of frames) {
    const dx = x - f.x, dz = z - f.z;
    const along = Math.max(Math.abs(dx * f.tx + dz * f.tz) - f.halfLength, 0);
    const across = Math.max(Math.abs(dx * f.tz - dz * f.tx) - f.halfWidth, 0);
    best = Math.min(best, Math.hypot(along, across));
  }
  return best;
}

/** Every metre along each run, so a long run can't hide a bad middle behind good ends. */
function dense(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

const runLength = (pts: Vec2[]) => pts.reduce((l, p, i) => (i ? l + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

describe('aryks on the real district', () => {
  const runs = aryks(d);

  it('runs along avenues, 0.6 m wide, none shorter than 6 m', () => {
    expect(runs.length).toBeGreaterThan(50);
    for (const r of runs) {
      expect(r.width).toBe(0.6);
      expect(runLength(r.points)).toBeGreaterThanOrEqual(6 - 1e-6);
    }
  });

  it('no point on a carriageway, junction polygon or crossing, nor within 4 m of a crossing', () => {
    for (const r of runs)
      for (const p of dense(r.points)) {
        expect(onCarriageway(p), `${p}`).toBe(false);
        expect(inJunction(p), `${p}`).toBe(false);
        expect(crossingGap(p), `${p}`).toBeGreaterThanOrEqual(4 - 0.01);
      }
  });

  it('breaks where a footway meets the road', () => {
    const ends = d.roads.filter(r => r.kind === 'footway').flatMap(f => [f.points[0], f.points[f.points.length - 1]]);
    const grid = new Grid<Vec2>();
    for (const e of ends) grid.add(e[0], e[1], e[0], e[1], e);
    for (const r of runs)
      for (const [x, z] of dense(r.points))
        for (const e of grid.query(x, z, 1)) expect(Math.hypot(e[0] - x, e[1] - z) < 1, `${x},${z}`).toBe(false);
  });

  it('no sample lies inside a bus shelter box plus 0.8 m', () => {
    const stops = d.furniture.filter(f => f.kind === 'busStop');
    expect(stops.length).toBeGreaterThan(20);
    for (const r of runs) for (const p of dense(r.points)) for (const f of stops) expect(pointInShelter(f, p[0], p[1], 0.8), `${p} vs ${f.x},${f.z}`).toBe(false);
  });

  it('sits at width / 2 + 1.6 beside its avenue', () => {
    const avenues = d.graph.edges.filter(e => AVENUE.has(roads.get(e.roadId)!.kind));
    const points = runs.flatMap(r => r.points);
    const beside = points.filter(([x, z]) => avenues.some(e => e.points.some((p, i) => i > 0 && Math.abs(segmentDistance(x, z, e.points[i - 1], p).d - (e.width / 2 + 1.6)) < 0.05)));
    // Mitred bend vertices sit a little further out, so not every point matches.
    expect(beside.length / points.length).toBeGreaterThan(0.8);
  });
});

describe('street lamps on the real district', () => {
  const lamps = lampPositions(d, LAMP_SEED);
  const trees = treePositions(d, TREE_SEED);
  const poles: Vec2[] = [
    ...d.signs.map(s => { const p = signPose(edges.get(s.edgeId)!, s); return [p.x, p.z] as Vec2; }),
    ...d.signals.map(s => { const p = signalPose(s, edges); return [p.x, p.z] as Vec2; }),
  ];

  it('places lamps along avenues', () => {
    expect(lamps.length).toBeGreaterThan(200);
  });

  it('none on a carriageway, junction polygon or within 3 m of a crossing', () => {
    for (const l of lamps) {
      const p: Vec2 = [l.x, l.z];
      expect(onCarriageway(p), `${p}`).toBe(false);
      expect(inJunction(p), `${p}`).toBe(false);
      expect(crossingGap(p), `${p}`).toBeGreaterThanOrEqual(3 - 0.01);
    }
  });

  it('none within 2 m of a tree, sign or signal pole', () => {
    for (const l of lamps)
      for (const [x, z] of [...trees, ...poles]) expect(Math.hypot(l.x - x, l.z - z) >= 2, `${l.x},${l.z}`).toBe(true);
  });

  it('no lamp stands in an aryk', () => {
    const segs = aryks(d).flatMap(r => r.points.slice(1).map((p, i) => [r.points[i], p] as [Vec2, Vec2]));
    for (const l of lamps) for (const [a, b] of segs) expect(segmentDistance(l.x, l.z, a, b).d >= 0.5, `${l.x},${l.z}`).toBe(true);
  });

  it('spaces lamps 32 m apart along a straight avenue edge', () => {
    const straight = (e: GraphEdge) => e.points.every(p => segmentDistance(p[0], p[1], e.points[0], e.points[e.points.length - 1]).d < 0.3);
    let checked = 0;
    for (const e of d.graph.edges) {
      if (!AVENUE.has(roads.get(e.roadId)!.kind) || !straight(e)) continue;
      const a = e.points[0], b = e.points[e.points.length - 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const s = lamps
        .filter(l => !l.double)
        .map(l => ({ l, sd: segmentDistance(l.x, l.z, a, b) }))
        .filter(({ sd }) => Math.abs(sd.d - (e.width / 2 + 0.8)) < 0.05 && sd.t > 0 && sd.t < 1)
        .map(({ sd }) => sd.t * len)
        .sort((x, y) => x - y);
      for (let i = 1; i < s.length; i++) {
        const gap = s[i] - s[i - 1];
        const k = Math.round(gap / 32);
        expect(k).toBeGreaterThanOrEqual(1);
        expect(Math.abs(gap - 32 * k)).toBeLessThanOrEqual(1);
        if (k === 1) checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('puts double-arm lamps in medians at least 2 m wide', () => {
    const doubles = lamps.filter(l => l.double);
    expect(doubles.length).toBeGreaterThan(0);
    for (const l of doubles) {
      const kerbs = d.graph.edges
        .map(e => Math.min(...e.points.slice(1).map((p, i) => segmentDistance(l.x, l.z, e.points[i], p).d)) - e.width / 2)
        .sort((x, y) => x - y);
      // The pole stands mid-median, so a 2 m median leaves at least 1 m to either kerb.
      expect(kerbs[0]).toBeGreaterThanOrEqual(1 - 0.05);
      expect(kerbs[1] - kerbs[0]).toBeLessThan(1);
    }
  });

  it('computes once per district and seed', () => {
    expect(lampPositions(d, LAMP_SEED)).toBe(lamps);
    expect(aryks(d)).toBe(aryks(d));
    expect(lampPositions(d, LAMP_SEED + 1)).not.toBe(lamps);
  });

  it('is deterministic for a seed', () => {
    expect(lampPositions(d, LAMP_SEED)).toEqual(lamps);
    expect(aryks(d)).toEqual(aryks(d));
  });

  it('every lamp sits beside an avenue edge', () => {
    for (const l of lamps) {
      const near = d.graph.edges.some(e => AVENUE.has(roads.get(e.roadId)!.kind)
        && e.points.some((p, i) => i > 0 && segmentDistance(l.x, l.z, e.points[i - 1], p).d < e.width / 2 + 16));
      expect(near).toBe(true);
    }
  });
});

describe('streetside meshes', () => {
  it('an aryk channel faces up and out and stays 0.6 m wide', () => {
    const g = arykGeometry([[0, 0], [10, 0], [20, 5]]);
    const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
    let up = 0;
    for (let i = 0; i < pos.count; i++) {
      const lateral = pos.getX(i) <= 10 ? Math.abs(pos.getZ(i)) : 0;
      expect(lateral).toBeLessThanOrEqual(0.3 + 1e-6);
      expect(nrm.getY(i)).toBeGreaterThanOrEqual(-1e-6);
      if (nrm.getY(i) > 0.99) up++;
    }
    expect(up).toBeGreaterThan(0);
  });

  it('a lamp is a 9 m pole with its arm reaching toward +z, the double one both ways', () => {
    const single = lampGeometry(false), double = lampGeometry(true);
    single.computeBoundingBox();
    double.computeBoundingBox();
    expect(single.boundingBox!.max.y).toBeGreaterThan(9);
    expect(single.boundingBox!.max.z).toBeGreaterThan(2);
    expect(single.boundingBox!.min.z).toBeGreaterThan(-0.3);
    expect(double.boundingBox!.min.z).toBeLessThan(-2);
  });
});
