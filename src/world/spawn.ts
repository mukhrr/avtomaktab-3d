import type { DistrictData, GraphEdge, Vec2 } from '../shared/district';
import { Grid, segmentDistance } from './spatial';

export interface Lane {
  position: Vec2;
  /** Radians, 0 = facing +z (south), PI/2 = facing +x (east). */
  heading: number;
  edge: GraphEdge;
}

interface Seg { edge: GraphEdge; a: Vec2; b: Vec2 }

const LOCAL_RADIUS = 60;
const grids = new WeakMap<DistrictData, { grid: Grid<Seg>; all: Seg[] }>();

function index(d: DistrictData) {
  let idx = grids.get(d);
  if (!idx) {
    const grid = new Grid<Seg>(), all: Seg[] = [];
    for (const edge of d.graph.edges)
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1], b = edge.points[i];
        const s = { edge, a, b };
        all.push(s);
        grid.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), s);
      }
    grids.set(d, (idx = { grid, all }));
  }
  return idx;
}

/** Centre of the rightmost lane (right-hand traffic) for travel along the closest edge. */
export function nearestLane(d: DistrictData, x: number, z: number, maxDistance = Infinity): Lane | null {
  const { grid, all } = index(d);
  const pick = (segs: Iterable<Seg>) => {
    let best: { s: Seg; t: number; d: number } | null = null;
    for (const s of segs) {
      const r = segmentDistance(x, z, s.a, s.b);
      if (r.d <= maxDistance && (!best || r.d < best.d)) best = { s, ...r };
    }
    return best;
  };
  const best = pick(grid.query(x, z, Math.min(maxDistance, LOCAL_RADIUS))) ?? (maxDistance > LOCAL_RADIUS ? pick(all) : null);
  if (!best) return null;

  const { s, t } = best;
  const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) || 1;
  const dx = (s.b[0] - s.a[0]) / len, dz = (s.b[1] - s.a[1]) / len;
  const laneWidth = s.edge.width / (s.edge.lanesForward + s.edge.lanesBackward);
  const off = s.edge.width / 2 - laneWidth / 2;
  const cx = s.a[0] + (s.b[0] - s.a[0]) * t, cz = s.a[1] + (s.b[1] - s.a[1]) * t;
  return { position: [cx - dz * off, cz + dx * off], heading: Math.atan2(dx, dz), edge: s.edge };
}
