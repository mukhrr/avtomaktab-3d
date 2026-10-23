import type { Approach, Crossing, GraphEdge, GraphNode, Signal, SignalController, Vec2 } from '../../src/shared/district';
import { cycleLength } from '../../src/sim/signals';
import { junctionTrim, pointAlong } from '../../src/world/roadGeometry';
import { edgeLength, locateNode } from './attach';
import { hash, type SignalDirection } from './extract';

const CLUSTER_RADIUS = 45;
const MAX_SNAP = 15;
const AXIS_TOLERANCE = Math.PI / 4;
const PED_STOP_GAP = 3;

interface SignalInput {
  id: string;
  position: Vec2;
  direction?: SignalDirection;
}

function distanceToPolyline(points: Vec2[], [px, pz]: Vec2): { dist: number; at: number } {
  let best = { dist: Infinity, at: 0 }, walked = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const dx = bx - ax, dz = bz - az, seg = Math.hypot(dx, dz);
    const t = seg ? Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / (seg * seg), 0), 1) : 0;
    const dist = Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
    if (dist < best.dist) best = { dist, at: walked + seg * t };
    walked += seg;
  }
  return best;
}

function lanes(edge: GraphEdge, dir: 1 | -1): number {
  return dir === 1 ? edge.lanesForward : edge.lanesBackward;
}

/** Travel bearing in radians at `stopAt` for a car going `dir` along the edge. */
function bearing(edge: GraphEdge, a: Approach): number {
  const h = pointAlong(edge.points, a.stopAt).heading;
  return a.dir === 1 ? h : h + Math.PI;
}

/** Angle between two bearings treated as undirected axes, in [0, PI/2]. */
function axisGap(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

function signalApproaches(
  s: SignalInput,
  edges: Map<string, GraphEdge>,
  allEdges: GraphEdge[],
  nodes: Map<string, GraphNode>,
): Approach[] {
  const hits = locateNode(allEdges, s.id);
  const atNode = nodes.get(s.id);
  const out: Approach[] = [];

  if (atNode && hits.length) {
    const touching = atNode.edges.map(id => edges.get(id)!).filter(Boolean);
    const trims = junctionTrim(atNode, touching);
    for (const e of touching) {
      const trim = trims.get(e.id) ?? 0;
      if (e.to === atNode.id && e.lanesForward > 0) out.push({ edgeId: e.id, dir: 1, stopAt: edgeLength(e) - trim });
      if (e.from === atNode.id && e.lanesBackward > 0) out.push({ edgeId: e.id, dir: -1, stopAt: trim });
    }
    return out;
  }

  let edgeId: string | undefined, at = 0;
  if (hits.length) ({ edgeId, at } = hits[0]);
  else {
    let best = MAX_SNAP;
    for (const e of allEdges) {
      const d = distanceToPolyline(e.points, s.position);
      if (d.dist < best) ({ dist: best, at } = d), (edgeId = e.id);
    }
  }
  if (!edgeId) return out;
  const edge = edges.get(edgeId)!;
  const len = edgeLength(edge);
  let dirs: (1 | -1)[];
  if (s.direction === 'forward') dirs = [1];
  else if (s.direction === 'backward') dirs = [-1];
  else if (s.direction === 'both') dirs = [1, -1];
  else {
    const isJunction = (id: string) => (nodes.get(id)?.edges.length ?? 0) >= 3;
    const candidates: { dir: 1 | -1; dist: number }[] = [];
    if (isJunction(edge.to)) candidates.push({ dir: 1, dist: len - at });
    if (isJunction(edge.from)) candidates.push({ dir: -1, dist: at });
    dirs = candidates.length ? [candidates.sort((a, b) => a.dist - b.dist)[0].dir] : [1, -1];
  }
  for (const dir of dirs) if (lanes(edge, dir) > 0) out.push({ edgeId, dir, stopAt: at });
  // On a oneway the nearest-junction guess can point against traffic; the only legal flow is then the approach.
  if (!out.length && !s.direction) for (const dir of [1, -1] as const) if (lanes(edge, dir) > 0) out.push({ edgeId, dir, stopAt: at });
  return out;
}

function cluster(signals: SignalInput[]): SignalInput[][] {
  const parent = signals.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const a = signals[i].position, b = signals[j].position;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= CLUSTER_RADIUS) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, SignalInput[]>();
  signals.forEach((s, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), s]));
  return [...groups.values()];
}

/** Idempotent per input: same inputs always give the same controllers, phases and offsets. */
export function buildControllers(
  signals: SignalInput[],
  edges: GraphEdge[],
  nodes: GraphNode[],
  crossings: Crossing[],
): { controllers: SignalController[]; signals: Signal[]; crossings: Crossing[] } {
  const edgeById = new Map(edges.map(e => [e.id, e]));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const outSignals = new Map<string, Signal>(signals.map(s => [s.id, { id: s.id, position: s.position }]));
  const sites: { controller: SignalController; positions: Vec2[] }[] = [];

  for (const group of cluster(signals)) {
    group.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const approaches: Approach[] = [];
    const seen = new Set<string>();
    for (const s of group) {
      const own = signalApproaches(s, edgeById, edges, nodeById);
      if (own.length) outSignals.get(s.id)!.approach = own[0];
      for (const a of own) {
        const key = `${a.edgeId}:${a.dir}`;
        if (!seen.has(key)) {
          seen.add(key);
          approaches.push(a);
        }
      }
    }
    if (!approaches.length) continue;
    const axis = bearing(edgeById.get(approaches[0].edgeId)!, approaches[0]);
    const phases: Approach[][] = [[], []];
    for (const a of approaches) phases[axisGap(axis, bearing(edgeById.get(a.edgeId)!, a)) <= AXIS_TOLERANCE ? 0 : 1].push(a);
    if (!phases[1].length) phases.pop();
    const id = group[0].id;
    for (const s of group) outSignals.get(s.id)!.controllerId = id;
    sites.push({ controller: { id, phases, offset: 0 }, positions: group.map(s => s.position) });
  }

  const outCrossings = crossings.map(c => ({ ...c }));
  for (const c of outCrossings) {
    if (c.kind !== 'signal') continue;
    let best: { controller: SignalController; dist: number } | undefined;
    for (const site of sites) {
      if (!site.controller.phases.flat().some(a => a.edgeId === c.edgeId)) continue;
      const dist = Math.min(...site.positions.map(p => Math.hypot(p[0] - c.position[0], p[1] - c.position[1])));
      if (dist <= CLUSTER_RADIUS && (!best || dist < best.dist)) best = { controller: site.controller, dist };
    }
    if (best) {
      const { phases } = best.controller;
      let walk = phases.findIndex(p => !p.some(a => a.edgeId === c.edgeId));
      if (walk < 0) walk = phases.push([]) - 1;
      c.controllerId = best.controller.id;
      c.walkPhase = walk;
    } else {
      const id = `ped-${c.id}`;
      sites.push({
        controller: {
          id,
          phases: [[{ edgeId: c.edgeId, dir: 1, stopAt: c.at - PED_STOP_GAP }, { edgeId: c.edgeId, dir: -1, stopAt: c.at + PED_STOP_GAP }], []],
          offset: 0,
        },
        positions: [c.position],
      });
      c.controllerId = id;
      c.walkPhase = 1;
    }
  }

  const controllers = sites.map(s => s.controller);
  for (const c of controllers) c.offset = hash(c.id) % cycleLength(c.phases);
  return { controllers, signals: [...outSignals.values()], crossings: outCrossings };
}
