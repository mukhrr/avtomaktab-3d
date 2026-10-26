import type { DistrictData, GraphEdge, Sign } from '../shared/district';
import { loadCatalogue } from '../shared/signCatalogue';
import { JUNCTION_REACH } from '../sim/signs';
import { project } from '../traffic/turns';
import type { ExamRoute } from './route';

const polyLength = (pts: GraphEdge['points']) => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
};

/** The signs the driver passes, in route order: those on its lanes between start and finish, then signs on side edges governing traffic that would enter them from a junction it crosses. */
export function signsOnRoute(d: DistrictData, route: ExamRoute): Sign[] {
  const edges = new Map(d.graph.edges.map(e => [e.id, e]));
  const nodes = new Map(d.graph.nodes.map(n => [n.id, n]));
  const byLane = new Map<string, Sign[]>();
  for (const s of d.signs) {
    const k = `${s.edgeId}|${s.dir}`;
    byLane.set(k, [...(byLane.get(k) ?? []), s]);
  }
  const out: Sign[] = [];
  const seen = new Set<string>();
  const take = (s: Sign) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    out.push(s);
  };

  const last = route.steps.length - 1;
  route.steps.forEach((step, i) => {
    const { edgeId, dir } = step.ref;
    const edge = edges.get(edgeId);
    if (!edge) throw new Error(`${route.id} drives missing edge ${edgeId}`);
    const from = i === 0 ? project(edge.points, route.start.position) : dir === 1 ? 0 : Infinity;
    const to = i === last ? project(edge.points, route.finish.position) : dir === 1 ? Infinity : 0;
    (byLane.get(`${edgeId}|${dir}`) ?? [])
      .filter(s => (s.at - from) * dir >= 0 && (to - s.at) * dir >= 0)
      .sort((a, b) => (a.at - b.at) * dir)
      .forEach(take);

    const node = step.nodeId && nodes.get(step.nodeId);
    if (!node) return;
    const next = route.steps[i + 1].ref;
    for (const id of node.edges) {
      const side = edges.get(id);
      if (!side) throw new Error(`${route.id}: node ${node.id} lists missing edge ${id}`);
      const len = polyLength(side.points);
      for (const away of [1, -1] as const) {
        if ((away === 1 ? side.from : side.to) !== node.id) continue;
        if (id === next.edgeId && away === next.dir) continue;
        if (id === step.ref.edgeId && away === -dir) continue;
        for (const s of byLane.get(`${id}|${away}`) ?? []) {
          if ((away === 1 ? s.at : len - s.at) <= JUNCTION_REACH) take(s);
        }
      }
    }
  });
  return out;
}

/** Catalogue numbers of the signs the route passes, plates included. */
export function entriesOnRoute(d: DistrictData, route: ExamRoute): Set<string> {
  const out = new Set<string>();
  for (const s of signsOnRoute(d, route)) {
    out.add(s.code);
    for (const p of s.plates ?? []) out.add(p.code);
  }
  return out;
}

/** Catalogue numbers, in catalogue order, that no route passes. */
export function missingEntries(d: DistrictData, routes: ExamRoute[]): string[] {
  const seen = new Set<string>();
  for (const r of routes) for (const n of entriesOnRoute(d, r)) seen.add(n);
  return loadCatalogue().map(e => e.number).filter(n => !seen.has(n));
}
