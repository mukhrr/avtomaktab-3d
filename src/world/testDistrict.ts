import type { DistrictData, GraphEdge, Road, Vec2 } from '../shared/district';

/** Tiny hand-made district for tests: an east-west two-way avenue and a north-south oneway street. */
export function testDistrict(): DistrictData {
  const road = (id: string, kind: string, points: Vec2[], width: number, oneway: boolean): Road => ({
    id, kind, width, lanes: 2, oneway, name: id, maxspeed: 60, points,
  });
  const edge = (r: Road, lanesForward: number, lanesBackward: number): GraphEdge => ({
    id: `${r.id}:0`, from: `${r.id}a`, to: `${r.id}b`, roadId: r.id, points: r.points,
    lanesForward, lanesBackward, width: r.width, maxspeed: 60, name: r.name,
  });
  const avenue = road('avenue', 'primary', [[-100, 0], [100, 0]], 8, false);
  const street = road('street', 'residential', [[50, -100], [50, -20]], 7, true);
  return {
    name: 'test', origin: { lat: 0, lon: 0 }, bounds: { minX: -120, maxX: 120, minZ: -120, maxZ: 120 },
    roads: [avenue, street],
    buildings: [{ id: 'b', height: 10, footprint: [[-40, 20], [-20, 20], [-20, 40], [-40, 40]] }],
    areas: [{ id: 'park', kind: 'green', outline: [[0, 30], [40, 30], [40, 70], [0, 70]] }],
    waterways: [], signals: [],
    graph: { nodes: [], edges: [edge(avenue, 1, 1), edge(street, 2, 0)] },
  };
}
