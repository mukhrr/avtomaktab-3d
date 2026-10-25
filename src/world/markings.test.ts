import type { GraphEdge, Road, Vec2 } from '../shared/district';
import { dashes, edgeMarkings } from './markings';

const straight: Vec2[] = [[0, 0], [100, 0]];
const road = (kind: string): Road => ({ id: 'r', kind, width: 0, lanes: 0, oneway: false, name: '', maxspeed: 60, points: straight });
const edge = (width: number, f: number, b: number): GraphEdge => ({
  id: 'r:0', from: 'a', to: 'b', roadId: 'r', points: straight, nodeIds: ['a', 'b'], lanesForward: f, lanesBackward: b, width, maxspeed: 60, name: '', kind: 'residential',
});

test('dashes are 3 m on, 6 m off', () => {
  const d = dashes([[0, 0], [20, 0]]);
  expect(d.map(([a, b]) => [a[0], b[0]])).toEqual([[0, 3], [9, 12], [18, 20]]);
});

test('narrow two-way road gets one dashed centre line', () => {
  expect(edgeMarkings(edge(7, 1, 1), road('residential'), straight)).toEqual([{ points: straight, dashed: true }]);
});

test('wide two-way road gets a solid centre and dashed lane dividers', () => {
  const lines = edgeMarkings(edge(14, 2, 2), road('primary'), straight);
  expect(lines.filter(l => !l.dashed)).toHaveLength(1);
  expect(lines.filter(l => l.dashed)).toHaveLength(2);
  expect(lines.find(l => !l.dashed)!.points[0][1]).toBeCloseTo(0);
});

test('3-lane oneway gets 2 dashed dividers, service roads get none', () => {
  expect(edgeMarkings(edge(10.5, 3, 0), road('primary'), straight).map(l => l.dashed)).toEqual([true, true]);
  expect(edgeMarkings(edge(7, 1, 1), road('service'), straight)).toEqual([]);
});
