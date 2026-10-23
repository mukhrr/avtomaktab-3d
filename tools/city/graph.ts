import type { GraphEdge, GraphNode, Road, Vec2 } from '../../src/shared/district';
import { FOOT_KINDS } from './extract';

export function buildRoadGraph(
  roads: Road[],
  roadNodeIds: Map<string, string[]>,
  project: (id: string) => Vec2,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const carRoads = roads.filter(r => !FOOT_KINDS.has(r.kind) && roadNodeIds.has(r.id));

  const uses = new Map<string, number>();
  for (const r of carRoads) for (const id of new Set(roadNodeIds.get(r.id))) uses.set(id, (uses.get(id) ?? 0) + 1);

  const nodes = new Map<string, GraphNode>();
  const nodeFor = (id: string) => {
    let n = nodes.get(id);
    if (!n) nodes.set(id, (n = { id, position: project(id), edges: [] }));
    return n;
  };

  const edges: GraphEdge[] = [];
  for (const r of carRoads) {
    const ids = roadNodeIds.get(r.id)!;
    const isNode = (i: number) => i === 0 || i === ids.length - 1 || (uses.get(ids[i]) ?? 0) >= 2;
    const lanesForward = r.oneway ? r.lanes : Math.max(1, Math.ceil(r.lanes / 2));
    const lanesBackward = r.oneway ? 0 : Math.max(1, Math.floor(r.lanes / 2));
    let start = 0, k = 0;
    for (let i = 1; i < ids.length; i++) {
      if (!isNode(i)) continue;
      const edge: GraphEdge = {
        id: `${r.id}:${k++}`,
        from: ids[start],
        to: ids[i],
        roadId: r.id,
        points: ids.slice(start, i + 1).map(project),
        nodeIds: ids.slice(start, i + 1),
        lanesForward,
        lanesBackward,
        width: r.width,
        maxspeed: r.maxspeed,
        name: r.name,
      };
      edges.push(edge);
      nodeFor(edge.from).edges.push(edge.id);
      nodeFor(edge.to).edges.push(edge.id);
      start = i;
    }
  }
  return { nodes: [...nodes.values()], edges };
}
