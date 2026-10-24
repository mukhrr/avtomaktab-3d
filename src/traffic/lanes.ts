import type { DistrictData, GraphEdge, GraphNode, Vec2 } from '../shared/district';
import type { SignSystem } from '../sim/signs';
import { junctionTrim, pointAlong, trimEdge } from '../world/roadGeometry';
import { turnBetween } from './turns';

export interface LaneRef {
  edgeId: string;
  dir: 1 | -1;
  /** 0 is the rightmost lane in the travel direction. */
  lane: number;
}

export interface LanePath {
  ref: LaneRef;
  points: Vec2[];
  length: number;
  /** Edge distances (from `edge.from`) where the path starts and ends. */
  startAt: number;
  endAt: number;
}

export function pointAt(points: Vec2[], s: number): { position: Vec2; heading: number } {
  const p = pointAlong(points, s);
  return { position: [p.x, p.z], heading: p.heading };
}

const polyLength = (pts: Vec2[]) => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
};

/** Shifts a polyline to the right of its travel direction, mitring corners. */
function offsetRight(pts: Vec2[], offset: number): Vec2[] {
  if (offset === 0) return pts.map(p => [p[0], p[1]]);
  const normals: Vec2[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
    const len = Math.hypot(dx, dz) || 1;
    normals.push([-dz / len, dx / len]);
  }
  return pts.map((p, i) => {
    const a = normals[Math.max(i - 1, 0)], b = normals[Math.min(i, normals.length - 1)];
    let nx = a[0] + b[0], nz = a[1] + b[1];
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    const scale = 1 / Math.max(nx * a[0] + nz * a[1], 0.5);
    return [p[0] + nx * offset * scale, p[1] + nz * offset * scale];
  });
}

const key = (r: LaneRef) => `${r.edgeId}|${r.dir}|${r.lane}`;

/** A noEntry sign this close to where a lane begins closes it to traffic turning in. */
const NO_ENTRY_REACH = 40;
const BANNED_BY = { noLeftTurn: 'left', noRightTurn: 'right', noUTurn: 'uturn' } as const;

export class LaneNetwork {
  private edges = new Map<string, GraphEdge>();
  private nodes = new Map<string, GraphNode>();
  private trims = new Map<string, Map<string, number>>();
  private paths = new Map<string, LanePath>();
  private connectors = new Map<string, Vec2[]>();

  constructor(d: DistrictData) {
    for (const e of d.graph.edges) this.edges.set(e.id, e);
    for (const n of d.graph.nodes) {
      this.nodes.set(n.id, n);
      this.trims.set(n.id, junctionTrim(n, n.edges.map(id => this.edges.get(id)!).filter(Boolean)));
    }
  }

  path(ref: LaneRef): LanePath {
    const k = key(ref);
    let p = this.paths.get(k);
    if (!p) this.paths.set(k, p = this.build(ref));
    return p;
  }

  private build(ref: LaneRef): LanePath {
    const e = this.edge(ref.edgeId);
    const startTrim = this.trims.get(e.from)?.get(e.id) ?? 0;
    const endTrim = this.trims.get(e.to)?.get(e.id) ?? 0;
    const trimmed = trimEdge(e, startTrim, endTrim);
    const len = polyLength(e.points);
    const total = startTrim + endTrim;
    const k = total > 0 ? (len - polyLength(trimmed)) / total : 1;
    const lo = startTrim * k, hi = len - endTrim * k;
    const lanes = e.lanesForward + e.lanesBackward;
    const offset = e.width / 2 - (ref.lane + 0.5) * e.width / lanes;
    const ordered = ref.dir === 1 ? trimmed : [...trimmed].reverse();
    const points = offsetRight(ordered, offset);
    return {
      ref, points, length: polyLength(points),
      startAt: ref.dir === 1 ? lo : hi,
      endAt: ref.dir === 1 ? hi : lo,
    };
  }

  /** With `signs`, exits a noEntry or turn-restriction sign forbids are left out unless nothing else remains. */
  exits(ref: LaneRef, signs?: SignSystem): LaneRef[] {
    const arrived = this.edge(ref.edgeId);
    const node = this.nodes.get(ref.dir === 1 ? arrived.to : arrived.from);
    if (!node) return [];
    const out: LaneRef[] = [];
    for (const id of node.edges) {
      if (id === arrived.id) continue;
      const e = this.edge(id);
      const dir = e.from === node.id ? 1 : -1;
      const avail = dir === 1 ? e.lanesForward : e.lanesBackward;
      if (avail > 0) out.push({ edgeId: id, dir, lane: Math.min(ref.lane, avail - 1) });
    }
    if (out.length) {
      if (!signs) return out;
      const allowed = out.filter(to => this.allowed(ref, to, signs));
      return allowed.length ? allowed : out;
    }
    const back = ref.dir === 1 ? arrived.lanesBackward : arrived.lanesForward;
    return back > 0 ? [{ edgeId: arrived.id, dir: ref.dir === 1 ? -1 : 1, lane: Math.min(ref.lane, back - 1) }] : [];
  }

  private allowed(from: LaneRef, to: LaneRef, signs: SignSystem): boolean {
    const e = this.edge(to.edgeId);
    const start = to.dir === 1 ? 0 : polyLength(e.points);
    if (signs.ahead(to.edgeId, to.dir, start, NO_ENTRY_REACH).some(g => g.type === 'noEntry')) return false;
    const turn = turnBetween(this, from, to);
    return !signs.atJunction(from).some(g => g.type in BANNED_BY && BANNED_BY[g.type as keyof typeof BANNED_BY] === turn);
  }

  connector(from: LaneRef, to: LaneRef): Vec2[] {
    const k = `${key(from)}>${key(to)}`;
    let c = this.connectors.get(k);
    if (!c) this.connectors.set(k, c = this.buildConnector(from, to));
    return c;
  }

  private buildConnector(from: LaneRef, to: LaneRef): Vec2[] {
    const a = this.path(from).points, b = this.path(to).points;
    const p0 = a[a.length - 1], p2 = b[0];
    const d0 = unit(a[a.length - 2] ?? p0, p0), d1 = unit(p2, b[1] ?? p2);
    const mid: Vec2 = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
    const cross = d0[0] * d1[1] - d0[1] * d1[0];
    let p1 = mid;
    if (Math.abs(cross) > 1e-3) {
      const rx = p2[0] - p0[0], rz = p2[1] - p0[1];
      const t = (rx * d1[1] - rz * d1[0]) / cross;
      const u = (rx * d0[1] - rz * d0[0]) / cross;
      // An intersection behind the start or past the end would swing the curve backwards.
      if (t >= 0 && u <= 0) p1 = [p0[0] + d0[0] * t, p0[1] + d0[1] * t];
    }
    const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(chord));
    const out: Vec2[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = 1 - t;
      out.push([s * s * p0[0] + 2 * s * t * p1[0] + t * t * p2[0], s * s * p0[1] + 2 * s * t * p1[1] + t * t * p2[1]]);
    }
    return out;
  }

  edgeS(ref: LaneRef, pathS: number): number {
    const p = this.path(ref);
    return ref.dir === 1 ? p.startAt + pathS : p.startAt - pathS;
  }

  pathS(ref: LaneRef, edgeS: number): number {
    const p = this.path(ref);
    return ref.dir === 1 ? edgeS - p.startAt : p.startAt - edgeS;
  }

  private edge(id: string): GraphEdge {
    const e = this.edges.get(id);
    if (!e) throw new Error(`unknown edge ${id}`);
    return e;
  }
}

function unit(a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}
