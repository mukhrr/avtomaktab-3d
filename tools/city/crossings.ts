import type { Crossing, GraphEdge, GraphNode } from '../../src/shared/district';
import { junctionTrim, pointAlong } from '../../src/world/roadGeometry';
import { edgeLength } from './attach';

/** Half the painted band along the road: ZEBRA_LENGTH / 2 in src/world/crossings.ts. */
export const CROSSING_HALF_LENGTH = 1.5;

/**
 * OSM often puts a crossing on the junction node itself. A marked one there would sit inside the junction, where a
 * car waiting to cross stands on it, so it moves back onto its approach just past the junction setback.
 */
export function crossingsOffJunctions(crossings: Crossing[], edges: GraphEdge[], nodes: GraphNode[]): Crossing[] {
  const byId = new Map(edges.map(e => [e.id, e]));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const setback = (nodeId: string, edgeId: string) => {
    const n = nodeById.get(nodeId);
    if (!n) return 0;
    return junctionTrim(n, n.edges.map(id => byId.get(id)!).filter(Boolean)).get(edgeId) ?? 0;
  };
  return crossings.map(c => {
    const e = byId.get(c.edgeId);
    if (!e || c.kind === 'unmarked') return c;
    const len = edgeLength(e);
    const from = setback(e.from, e.id), to = setback(e.to, e.id);
    const lo = from > 0 ? from + CROSSING_HALF_LENGTH : 0, hi = to > 0 ? len - to - CROSSING_HALF_LENGTH : len;
    // An edge too short for both setbacks gets its crossing halfway between them.
    const at = lo > hi ? (lo + hi) / 2 : Math.min(Math.max(c.at, lo), hi);
    if (Math.abs(at - c.at) < 1e-9) return c;
    const p = pointAlong(e.points, at);
    return { ...c, at, position: [p.x, p.z] };
  });
}
