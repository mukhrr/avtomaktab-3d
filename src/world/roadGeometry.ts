import type { GraphEdge, GraphNode, Vec2 } from '../shared/district';

const MIN_REMAINING = 0.1;
const MAX_TRIM_SHARE = 0.45;
const JUNCTION_MARGIN = 1;

/** Flat strip along a polyline at y = 0, mitred at joints with the mitre capped at 2x half-width. */
export function ribbon(points: Vec2[], width: number): { positions: number[]; indices: number[] } {
  const positions: number[] = [], indices: number[] = [], h = width / 2;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, points.length - 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    let s = h;
    if (i > 0 && i < points.length - 1) {
      const px = points[i][0] - a[0], pz = points[i][1] - a[1], pl = Math.hypot(px, pz) || 1;
      const cos = (px / pl) * dx + (pz / pl) * dz;
      s = h / Math.max(Math.sqrt((1 + cos) / 2), 0.5);
    }
    const [x, z] = points[i];
    positions.push(x - dz * s, 0, z + dx * s, x + dz * s, 0, z - dx * s);
    if (i > 0) {
      const k = (i - 1) * 2;
      indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  return { positions, indices };
}

function length(points: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return l;
}

/** Points of the polyline between distance `from` and `to` along it. */
function slice(points: Vec2[], from: number, to: number): Vec2[] {
  const out: Vec2[] = [];
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const seg = Math.hypot(bx - ax, bz - az);
    const at = (t: number): Vec2 => [ax + (bx - ax) * t, az + (bz - az) * t];
    if (out.length === 0 && from <= d + seg) out.push(at(seg ? (from - d) / seg : 0));
    if (to <= d + seg) {
      out.push(at(seg ? (to - d) / seg : 0));
      return out;
    }
    if (out.length) out.push([bx, bz]);
    d += seg;
  }
  return out;
}

export function trimEdge(edge: GraphEdge, startTrim: number, endTrim: number): Vec2[] {
  const len = length(edge.points);
  const total = startTrim + endTrim, max = len * (1 - MIN_REMAINING);
  const k = total > max ? max / total : 1;
  return slice(edge.points, startTrim * k, len - endTrim * k);
}

/** Metres to cut from each edge end at this node; empty for nodes that aren't junctions. */
export function junctionTrim(node: GraphNode, edges: GraphEdge[]): Map<string, number> {
  const trims = new Map<string, number>();
  if (edges.length < 3) return trims;
  for (const e of edges) {
    const widest = Math.max(...edges.filter(o => o !== e).map(o => o.width));
    trims.set(e.id, Math.min(widest / 2 + JUNCTION_MARGIN, length(e.points) * MAX_TRIM_SHARE));
  }
  return trims;
}

function convexHull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Vec2[]) => {
    const h: Vec2[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

export function junctionPolygon(node: GraphNode, edges: GraphEdge[]): Vec2[] {
  const trims = junctionTrim(node, edges);
  const corners: Vec2[] = [];
  for (const e of edges) {
    const ends: Vec2[][] = [];
    if (e.from === node.id) ends.push(e.points);
    if (e.to === node.id) ends.push([...e.points].reverse());
    for (const pts of ends) {
      const [x, z] = slice(pts, trims.get(e.id) ?? 0, trims.get(e.id) ?? 0)[0];
      const [nx, nz] = pts[1];
      const d = Math.hypot(nx - pts[0][0], nz - pts[0][1]) || 1;
      const dx = (nx - pts[0][0]) / d, dz = (nz - pts[0][1]) / d, h = e.width / 2;
      corners.push([x - dz * h, z + dx * h], [x + dz * h, z - dx * h]);
    }
  }
  return convexHull(corners);
}
