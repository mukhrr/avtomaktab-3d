import type { GraphEdge } from '../../src/shared/district';

export function edgeLength(edge: GraphEdge): number {
  let total = 0;
  for (let i = 1; i < edge.points.length; i++) {
    total += Math.hypot(edge.points[i][0] - edge.points[i - 1][0], edge.points[i][1] - edge.points[i - 1][1]);
  }
  return total;
}

/** Every edge containing the node, with `at` as the path length from `edge.from`. */
export function locateNode(edges: GraphEdge[], nodeId: string): { edgeId: string; at: number; index: number }[] {
  const found: { edgeId: string; at: number; index: number }[] = [];
  for (const edge of edges) {
    const index = edge.nodeIds.indexOf(nodeId);
    if (index < 0) continue;
    found.push({ edgeId: edge.id, at: edgeLength({ ...edge, points: edge.points.slice(0, index + 1) }), index });
  }
  return found;
}
