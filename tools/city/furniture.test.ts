import type { Crossing, GraphEdge, GraphNode } from '../../src/shared/district';
import type { RawFurniture } from './extract';
import { placeFurniture } from './furniture';

// One 8 m wide road along x at z = 0, with a junction at its east end.
const edge: GraphEdge = {
  id: 'r:0', from: 'a', to: 'b', roadId: 'r', points: [[0, 0], [100, 0]], nodeIds: ['1', '2'],
  lanesForward: 1, lanesBackward: 1, width: 8, maxspeed: 60, name: '',
};
const side: GraphEdge = { ...edge, id: 's:0', from: 'b', to: 'c', roadId: 's', points: [[100, 0], [100, 60]], nodeIds: ['2', '3'] };
const nodes: GraphNode[] = [
  { id: 'a', position: [0, 0], edges: ['r:0'] },
  { id: 'b', position: [100, 0], edges: ['r:0', 's:0'] },
  { id: 'c', position: [100, 60], edges: ['s:0'] },
];
const kinds = new Map([['r', 'secondary'], ['s', 'residential']]);
const zebra: Crossing = { id: 'z', position: [50, 0], kind: 'zebra', edgeId: 'r:0', at: 50, width: 8 };
const at = (id: string, kind: RawFurniture['kind'], x: number, z: number): RawFurniture => ({ id, kind, position: [x, z] });
const place = (...raw: RawFurniture[]) => placeFurniture(raw, [edge, side], nodes, [zebra], kinds);

test('a bus stop on the carriageway stands 1.5 m beyond the kerb facing the road', () => {
  const [stop] = place(at('b1', 'busStop', 20, 0.5)).items;
  expect(stop.z).toBeCloseTo(5.5, 1);
  expect(stop.x).toBeCloseTo(20, 1);
  expect(stop.heading).toBeCloseTo(Math.PI, 2);
});

test('a bench in the carriageway moves out to 0.8 m from the kerb and is counted', () => {
  const r = place(at('n1', 'bench', 30, -1));
  expect(r.items[0].z).toBeCloseTo(-4.8, 1);
  expect(r.moved.bench).toBe(1);
});

test('a bench in the open stays where it is, facing the road', () => {
  const r = place(at('n2', 'bench', 30, 10));
  expect(r.items[0]).toMatchObject({ x: 30, z: 10 });
  expect(r.items[0].heading).toBeCloseTo(Math.PI, 2);
  expect(r.moved.bench).toBe(0);
});

test('items on a crossing strip are dropped, bus stops slide clear along the road', () => {
  const r = place(at('n3', 'bin', 50, 6), at('b2', 'busStop', 50, 5));
  expect(r.items.map(i => i.id)).toEqual(['b2']);
  expect(r.dropped.bin).toBe(1);
  expect(Math.abs(r.items[0].x - 50)).toBeGreaterThan(5);
});

test('a bus stop mapped far from any road is dropped', () => {
  expect(place(at('b3', 'busStop', 50, 120)).dropped.busStop).toBe(1);
});

test('a bus stop whose shelter would stand in a building slides along the road to a free spot', () => {
  const building = [[10, 5], [30, 5], [30, 12], [10, 12]] as [number, number][];
  const r = placeFurniture([at('b4', 'busStop', 20, 0)], [edge, side], nodes, [zebra], kinds, [building]);
  expect(r.items).toHaveLength(1);
  expect(r.items[0].x).toBeGreaterThan(30);
});

test('a bus stop with no building-free slot within reach is dropped', () => {
  const wall = [[-50, 4], [200, 4], [200, 12], [-50, 12]] as [number, number][];
  expect(placeFurniture([at('b5', 'busStop', 20, 0)], [edge, side], nodes, [zebra], kinds, [wall]).dropped.busStop).toBe(1);
});
