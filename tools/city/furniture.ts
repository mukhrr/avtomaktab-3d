import type { Crossing, Furniture, FurnitureKind, GraphEdge, GraphNode, Vec2 } from '../../src/shared/district';
import { junctionPolygon, junctionTrim } from '../../src/world/roadGeometry';
import { SHELTER_LENGTH, shelterCorners } from '../../src/shared/shelter';
import { Grid, pointInPolygon, polygonsOverlap, segmentDistance } from '../../src/world/spatial';
import { crossingFrame, type CrossingFrame } from '../../src/world/streetside';
import { FOOT_KINDS, type RawFurniture } from './extract';

const STOP_SETBACK = 1.5;
const STOP_CLEARANCE: [number, number] = [1, 2.5];
const MIN_CLEARANCE = 0.8;
const SEARCH = 150;
/** A stop mapped further than this from any road is a mapping error, not a stop to snap. */
const STOP_REACH = 30;
const SLIDE_STEP = 2;
const SLIDE_MAX = 16;
const JUNCTION_MARGIN = 0.5;
const CROSSING_MARGIN = 1;
const MOVED = 0.25;

export type FurnitureCounts = Record<FurnitureKind, number>;
export interface FurnitureResult { items: Furniture[]; moved: FurnitureCounts; dropped: FurnitureCounts }

interface Seg { a: Vec2; b: Vec2; half: number }
interface Hit { clearance: number; half: number; qx: number; qz: number; dist: number; tx: number; tz: number }
interface Pose { x: number; z: number; heading: number }

const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;

function polygonGap(poly: Vec2[], x: number, z: number): number {
  if (pointInPolygon(x, z, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, segmentDistance(x, z, poly[j], poly[i]).d);
  return best;
}

function frameGap(f: CrossingFrame, x: number, z: number): number {
  const dx = x - f.x, dz = z - f.z;
  const along = Math.max(Math.abs(dx * f.tx + dz * f.tz) - f.halfLength, 0);
  const across = Math.max(Math.abs(dx * f.tz - dz * f.tx) - f.halfWidth, 0);
  return Math.hypot(along, across);
}

/**
 * Snaps bus stops to the kerb, nudges benches and bins out of the carriageway, and drops what cannot be
 * placed in the open. Only roads cars drive on count as carriageway; a bench on a footway is fine.
 */
export function placeFurniture(
  raw: RawFurniture[], edges: GraphEdge[], nodes: GraphNode[], crossings: Crossing[], roadKind: Map<string, string>, footprints: Vec2[][] = [],
): FurnitureResult {
  const byId = new Map(edges.map(e => [e.id, e]));
  const road = new Grid<Seg>();
  for (const e of edges) {
    if (FOOT_KINDS.has(roadKind.get(e.roadId) ?? '')) continue;
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], b = e.points[i], h = e.width / 2;
      road.add(Math.min(a[0], b[0]) - h, Math.min(a[1], b[1]) - h, Math.max(a[0], b[0]) + h, Math.max(a[1], b[1]) + h, { a, b, half: h });
    }
  }
  const junctions = new Grid<Vec2[]>();
  for (const n of nodes) {
    const touching = n.edges.map(id => byId.get(id)!);
    if (!junctionTrim(n, touching).size) continue;
    const poly = junctionPolygon(n, touching), xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
    junctions.add(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), poly);
  }
  const buildings = new Grid<Vec2[]>();
  for (const f of footprints) {
    const xs = f.map(p => p[0]), zs = f.map(p => p[1]);
    buildings.add(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), f);
  }
  const strips = new Grid<CrossingFrame>();
  for (const c of crossings) {
    const e = byId.get(c.edgeId);
    if (!e) continue;
    const f = crossingFrame(c, e), r = Math.hypot(f.halfLength, f.halfWidth);
    strips.add(f.x - r, f.z - r, f.x + r, f.z + r, f);
  }

  // The grid is cell-coarse, so a segment's own box is not enough: query wide, then take the true nearest.
  const nearest = (x: number, z: number): Hit | null => {
    let best: Hit | null = null;
    for (const s of road.query(x, z, SEARCH)) {
      const { d, t } = segmentDistance(x, z, s.a, s.b);
      if (d > SEARCH || (best && d - s.half >= best.clearance)) continue;
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], l = Math.hypot(dx, dz) || 1;
      best = { clearance: d - s.half, half: s.half, dist: d, qx: s.a[0] + dx * t, qz: s.a[1] + dz * t, tx: dx / l, tz: dz / l };
    }
    return best;
  };
  const inJunction = (x: number, z: number, margin: number) => {
    for (const p of junctions.query(x, z, margin)) if (polygonGap(p, x, z) < margin) return true;
    return false;
  };
  const onCrossing = (x: number, z: number, margin: number) => {
    for (const f of strips.query(x, z, margin)) if (frameGap(f, x, z) < margin) return true;
    return false;
  };
  /** Unit vector from the road's centreline to the point; a point on the centreline goes to the road's left. */
  const outward = (h: Hit, x: number, z: number): Vec2 => (h.dist > 1e-6 ? [(x - h.qx) / h.dist, (z - h.qz) / h.dist] : [-h.tz, h.tx]);
  const facing = (h: Hit, x: number, z: number) => Math.atan2(h.qx - x, h.qz - z);
  const beyondKerb = (h: Hit, x: number, z: number, gap: number): Vec2 => {
    const [nx, nz] = outward(h, x, z);
    return [h.qx + nx * (h.half + gap), h.qz + nz * (h.half + gap)];
  };

  const stopAt = (x: number, z: number): Pose | null => {
    const h = nearest(x, z);
    if (!h || h.clearance > STOP_REACH) return null;
    const [px, pz] = beyondKerb(h, x, z, STOP_SETBACK);
    const after = nearest(px, pz);
    if (!after || after.clearance < STOP_CLEARANCE[0] || after.clearance > STOP_CLEARANCE[1]) return null;
    const heading = facing(after, px, pz);
    const ax = Math.cos(heading), az = -Math.sin(heading);
    for (const s of [-1, 0, 1]) {
      const sx = px + ax * s * SHELTER_LENGTH / 2, sz = pz + az * s * SHELTER_LENGTH / 2;
      if ((nearest(sx, sz)?.clearance ?? Infinity) < MIN_CLEARANCE) return null;
      if (inJunction(sx, sz, JUNCTION_MARGIN) || onCrossing(sx, sz, CROSSING_MARGIN)) return null;
    }
    const box = shelterCorners({ x: px, z: pz, heading }, 0);
    for (const f of buildings.query(px, pz, SHELTER_LENGTH)) if (polygonsOverlap(box, f)) return null;
    return { x: px, z: pz, heading };
  };

  const standAt = (x: number, z: number): Pose | null => {
    const h = nearest(x, z);
    if (!h) return null;
    const [px, pz] = h.clearance < MIN_CLEARANCE ? beyondKerb(h, x, z, MIN_CLEARANCE) : [x, z];
    const after = nearest(px, pz);
    if (!after || after.clearance < MIN_CLEARANCE - 1e-6 || inJunction(px, pz, 0.01) || onCrossing(px, pz, 0.01)) return null;
    return { x: px, z: pz, heading: facing(after, px, pz) };
  };

  const items: Furniture[] = [];
  const moved: FurnitureCounts = { busStop: 0, bench: 0, bin: 0 }, dropped: FurnitureCounts = { busStop: 0, bench: 0, bin: 0 };
  for (const r of raw) {
    const [x, z] = r.position;
    let placed: Pose | null;
    if (r.kind === 'busStop') {
      placed = stopAt(x, z);
      const h = nearest(x, z);
      // A stop that lands on a junction or crossing slides along the road to the nearest clear spot.
      for (let step = SLIDE_STEP; !placed && h && step <= SLIDE_MAX; step += SLIDE_STEP)
        for (const sign of [1, -1]) placed ??= stopAt(x + h.tx * step * sign, z + h.tz * step * sign);
    } else placed = standAt(x, z);
    if (!placed) {
      dropped[r.kind]++;
      continue;
    }
    if (Math.hypot(placed.x - x, placed.z - z) > MOVED) moved[r.kind]++;
    items.push({ id: r.id, kind: r.kind, x: round(placed.x, 2), z: round(placed.z, 2), heading: round(placed.heading, 3) });
  }
  return { items, moved, dropped };
}
