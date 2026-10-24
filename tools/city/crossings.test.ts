import type { Crossing, GraphEdge, GraphNode } from '../../src/shared/district';
import { junctionTrim } from '../../src/world/roadGeometry';
import { CROSSING_HALF_LENGTH, crossingsOffJunctions } from './crossings';

const arm = (name: string, end: [number, number]): GraphEdge => ({
  id: name, from: 'c', to: `${name}-end`, roadId: name, points: [[0, 0], end], nodeIds: ['c', `${name}-end`],
  lanesForward: 1, lanesBackward: 1, width: 7, maxspeed: 60, name,
});
const edges = [arm('N', [0, -60]), arm('E', [60, 0]), arm('W', [-60, 0])];
const nodes: GraphNode[] = [
  { id: 'c', position: [0, 0], edges: edges.map(e => e.id) },
  ...edges.map(e => ({ id: e.to, position: e.points[1], edges: [e.id] })),
];
const crossing = (id: string, kind: Crossing['kind'], edgeId: string, at: number, position: [number, number]): Crossing => ({
  id, kind, edgeId, at, position, width: 7,
});
const setback = junctionTrim(nodes[0], edges).get('E')!;

test('a marked crossing on the junction node moves out onto its arm past the junction setback', () => {
  const [z] = crossingsOffJunctions([crossing('z', 'zebra', 'E', 0, [0, 0])], edges, nodes);
  expect(z.at).toBeCloseTo(setback + CROSSING_HALF_LENGTH);
  expect(z.position[0]).toBeCloseTo(setback + CROSSING_HALF_LENGTH);
  expect(z.position[1]).toBeCloseTo(0);
});

test('a signal crossing inside the setback moves out too; one already clear stays put', () => {
  const [inside, clear] = crossingsOffJunctions(
    [crossing('s', 'signal', 'E', 2, [2, 0]), crossing('t', 'signal', 'E', 30, [30, 0])], edges, nodes,
  );
  expect(inside.at).toBeCloseTo(setback + CROSSING_HALF_LENGTH);
  expect(clear).toEqual(crossing('t', 'signal', 'E', 30, [30, 0]));
});

test('unmarked crossings and crossings at a plain road end are left alone', () => {
  const kept = [crossing('u', 'unmarked', 'E', 0, [0, 0]), crossing('x', 'zebra', 'E', 60, [60, 0])];
  expect(crossingsOffJunctions(kept, edges, nodes)).toEqual(kept);
});
