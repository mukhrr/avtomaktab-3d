import type { Approach, Crossing, DistrictData, GraphEdge, GraphNode, Road, Signal, Vec2 } from '../shared/district';
import { junctionTrim, pointAlong } from '../world/roadGeometry';

/*
 * Nodes (x east, z south, metres):
 *   cross (0,0) signalised, arms n (0,-120), s (0,120), w (-120,0), e = 240 m to t
 *   t (240,0)   unsignalled T: e arrives, tE continues to x (360,0), tStub dead-ends at d (240,40)
 *   x (360,0)   tE ends here; oneway pair o1 (x to a (360,-80), dead end) and o2 (a2 (372,-80) to x)
 * Edges n, e, w, tStub, tE and o1 run away from their first node; s runs toward the cross.
 * Zebra z1 sits on w, 40 m from the cross. Footway fw1 runs 6 m north of w.
 */

const TWO_WAY = { lanesForward: 1, lanesBackward: 1, width: 7 };
const ONEWAY = { lanesForward: 1, lanesBackward: 0, width: 4 };

const nodePos: Record<string, Vec2> = {
  cross: [0, 0], n: [0, -120], s: [0, 120], w: [-120, 0],
  t: [240, 0], d: [240, 40], x: [360, 0], a: [360, -80], a2: [372, -80],
};

function edge(id: string, from: string, to: string, via: Vec2[], lanes: typeof TWO_WAY | typeof ONEWAY): GraphEdge {
  const points = [nodePos[from], ...via, nodePos[to]];
  const nodeIds = [from, ...via.map((_, i) => `${id}_${i}`), to];
  return { id, from, to, roadId: id, points, nodeIds, ...lanes, maxspeed: 60, name: id, kind: 'residential' };
}

const polyLength = (pts: Vec2[]) =>
  pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

export function testNetwork(): DistrictData {
  const edges: GraphEdge[] = [
    edge('n', 'cross', 'n', [], TWO_WAY),
    edge('s', 's', 'cross', [], TWO_WAY),
    edge('w', 'cross', 'w', [], TWO_WAY),
    edge('e', 'cross', 't', [], TWO_WAY),
    edge('tE', 't', 'x', [], TWO_WAY),
    edge('tStub', 't', 'd', [], TWO_WAY),
    edge('o1', 'x', 'a', [], ONEWAY),
    edge('o2', 'a2', 'x', [[372, -10]], ONEWAY),
  ];
  const byId = new Map(edges.map(e => [e.id, e]));
  const nodes: GraphNode[] = Object.entries(nodePos).map(([id, position]) => ({
    id, position, edges: edges.filter(e => e.from === id || e.to === id).map(e => e.id),
  }));

  const crossNode = nodes.find(n => n.id === 'cross')!;
  const trims = junctionTrim(crossNode, crossNode.edges.map(id => byId.get(id)!));
  // Cars heading into the cross stop at the trimmed end of each arm.
  const approaches: Record<string, Approach> = {
    n: { edgeId: 'n', dir: -1, stopAt: trims.get('n')! },
    s: { edgeId: 's', dir: 1, stopAt: polyLength(byId.get('s')!.points) - trims.get('s')! },
    w: { edgeId: 'w', dir: -1, stopAt: trims.get('w')! },
    e: { edgeId: 'e', dir: -1, stopAt: trims.get('e')! },
  };
  const controllers = [{ id: 'c1', offset: 0, phases: [[approaches.n, approaches.s], [approaches.w, approaches.e]] }];

  const signals: Signal[] = Object.values(approaches).map(a => {
    const p = pointAlong(byId.get(a.edgeId)!.points, a.stopAt);
    // Travel direction along the edge, then 5 m to its right (-dz, dx).
    const dx = Math.sin(p.heading) * a.dir, dz = Math.cos(p.heading) * a.dir;
    return { id: `sig_${a.edgeId}`, position: [p.x - dz * 5, p.z + dx * 5] as Vec2, controllerId: 'c1', approach: a };
  });

  const crossings: Crossing[] = [{ id: 'z1', position: [-40, 0], kind: 'zebra', edgeId: 'w', at: 40, width: 3 }];

  const roads: Road[] = [
    ...edges.map(e => ({
      id: e.roadId, kind: 'residential', width: e.width, lanes: e.lanesForward + e.lanesBackward,
      oneway: e.lanesBackward === 0, name: e.name, maxspeed: e.maxspeed, points: e.points,
    })),
    { id: 'fw1', kind: 'footway', width: 2, lanes: 0, oneway: false, name: '', maxspeed: 0, points: [[-10, -6], [-120, -6]] },
  ];

  return {
    name: 'test-network',
    origin: { lat: 0, lon: 0 },
    bounds: { minX: -130, maxX: 380, minZ: -130, maxZ: 130 },
    roads, buildings: [], areas: [], waterways: [], signals, crossings, controllers, signs: [], furniture: [], landmarks: [], pois: [],
    graph: { nodes, edges },
  };
}
