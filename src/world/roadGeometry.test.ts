import type { GraphEdge, GraphNode, Vec2 } from '../shared/district';
import { junctionPolygon, junctionTrim, ribbon, trimEdge } from './roadGeometry';
import { signedArea } from '../../tools/city/extract';

const edge = (id: string, from: string, to: string, points: Vec2[], width = 6): GraphEdge => ({
  id, from, to, roadId: id, points, width, lanesForward: 1, lanesBackward: 1, maxspeed: 60, name: '',
});
const center: GraphNode = { id: 'c', position: [0, 0], edges: ['n', 'e', 's', 'w'] };
const cross = [
  edge('n', 'c', 'N', [[0, 0], [0, -50]]),
  edge('e', 'c', 'E', [[0, 0], [50, 0]]),
  edge('s', 'S', 'c', [[0, 50], [0, 0]]),
  edge('w', 'W', 'c', [[-50, 0], [0, 0]]),
];

test('straight ribbon has 4 vertices at plus/minus half width', () => {
  const { positions, indices } = ribbon([[0, 0], [10, 0]], 6);
  expect(positions).toHaveLength(12);
  expect(indices).toHaveLength(6);
  const zs = [positions[2], positions[5], positions[8], positions[11]].map(Math.abs);
  expect(zs).toEqual([3, 3, 3, 3]);
});

test('mitred corner on a 90 degree bend stays within 2x half width', () => {
  const { positions } = ribbon([[0, 0], [10, 0], [10, 10]], 6);
  const dx = positions[6] - 10, dz = positions[8];
  expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(6 + 1e-9);
});

test('4-way cross of 6 m roads trims every edge by 4 m', () => {
  const t = junctionTrim(center, cross);
  expect([...t.values()]).toEqual([4, 4, 4, 4]);
});

test('a bend node with 2 edges is not trimmed', () => {
  expect(junctionTrim({ id: 'c', position: [0, 0], edges: ['n', 'e'] }, cross.slice(0, 2)).size).toBe(0);
});

test('junction polygon is counter-clockwise, contains the node, has at most 8 points', () => {
  const poly = junctionPolygon(center, cross);
  expect(poly.length).toBeLessThanOrEqual(8);
  expect(signedArea(poly)).toBeGreaterThan(0);
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  expect(Math.min(...xs)).toBeLessThan(0);
  expect(Math.max(...xs)).toBeGreaterThan(0);
  expect(Math.min(...zs)).toBeLessThan(0);
  expect(Math.max(...zs)).toBeGreaterThan(0);
});

test('trimEdge cuts both ends along the polyline', () => {
  expect(trimEdge(edge('x', 'a', 'b', [[0, 0], [10, 0], [20, 0]]), 4, 5)).toEqual([[4, 0], [10, 0], [15, 0]]);
});

test('trimming never leaves less than 10% of the edge', () => {
  const pts = trimEdge(edge('x', 'a', 'b', [[0, 0], [10, 0]]), 8, 8);
  expect(pts.at(-1)![0] - pts[0][0]).toBeCloseTo(1);
});
