import type { GraphEdge } from '../../src/shared/district';
import { edgeLength, locateNode } from './attach';

const edge = (id: string, points: [number, number][], nodeIds: string[]): GraphEdge => ({
  id, from: nodeIds[0], to: nodeIds.at(-1)!, roadId: 'r', points, nodeIds,
  lanesForward: 1, lanesBackward: 1, width: 7, maxspeed: 60, name: '', kind: 'residential',
});

const e1 = edge('r:0', [[0, 0], [10, 0], [10, 10]], ['a', 'b', 'c']);

test('locateNode gives the path length from the edge start', () => {
  expect(locateNode([e1], 'a')).toEqual([{ edgeId: 'r:0', at: 0, index: 0 }]);
  expect(locateNode([e1], 'b')).toEqual([{ edgeId: 'r:0', at: 10, index: 1 }]);
  expect(locateNode([e1], 'c')).toEqual([{ edgeId: 'r:0', at: 20, index: 2 }]);
});

test('a junction node returns one entry per touching edge', () => {
  const e2 = edge('r:1', [[10, 10], [30, 10]], ['c', 'd']);
  expect(locateNode([e1, e2], 'c')).toEqual([
    { edgeId: 'r:0', at: 20, index: 2 },
    { edgeId: 'r:1', at: 0, index: 0 },
  ]);
  expect(locateNode([e1, e2], 'zzz')).toEqual([]);
});

test('edgeLength sums segment lengths', () => {
  expect(edgeLength(e1)).toBe(20);
});
