import type { Crossing, GraphEdge, GraphNode } from '../../src/shared/district';
import { junctionTrim } from '../../src/world/roadGeometry';
import { buildControllers } from './controllers';

const arm = (name: string, end: [number, number], lanesBackward = 2): GraphEdge => ({
  id: name, from: 'c', to: `${name}-end`, roadId: name, points: [[0, 0], end], nodeIds: ['c', `${name}-end`],
  lanesForward: 2, lanesBackward, width: 7, maxspeed: 60, name,
});
const arms = (n = 2, e = 2, s = 2, w = 2) => [arm('N', [0, -60], n), arm('E', [60, 0], e), arm('S', [0, 60], s), arm('W', [-60, 0], w)];
const nodes = (edges: GraphEdge[]): GraphNode[] => [
  { id: 'c', position: [0, 0], edges: edges.map(e => e.id) },
  ...edges.map(e => ({ id: e.to, position: e.points[1], edges: [e.id] })),
];
// 20 m from c on each arm; ids are not on the edges, so the position fallback places them.
const sig = (id: string, position: [number, number], direction?: 'forward' | 'backward' | 'both') => ({ id, position, direction });
const cross4 = [sig('1', [0, -20]), sig('2', [20, 0]), sig('3', [0, 20]), sig('4', [-20, 0])];
const signalCrossing = (id: string, edgeId: string, at: number, position: [number, number]): Crossing => ({
  id, position, kind: 'signal', edgeId, at, width: 7,
});

test('four untagged arm signals form one controller with two phases', () => {
  const edges = arms();
  const r = buildControllers(cross4, edges, nodes(edges), []);
  expect(r.controllers).toHaveLength(1);
  const [c] = r.controllers;
  expect(c.id).toBe('1');
  expect(c.phases).toHaveLength(2);
  const edgesOf = (p: number) => c.phases[p].map(a => a.edgeId).sort();
  expect(edgesOf(0)).toEqual(['N', 'S']);
  expect(edgesOf(1)).toEqual(['E', 'W']);
  for (const a of c.phases.flat()) {
    expect(a.dir).toBe(-1);
    expect(a.stopAt).toBe(20);
  }
  expect(r.signals.every(s => s.controllerId === '1' && s.approach)).toBe(true);
});

test('signals 200 m apart are separate controllers', () => {
  const edges = [arm('N', [0, -300])];
  const r = buildControllers([sig('a', [0, -20]), sig('b', [0, -220])], edges, nodes(edges), []);
  expect(r.controllers.map(c => c.id).sort()).toEqual(['a', 'b']);
});

test('a oneway arm never gets an approach against traffic', () => {
  const edges = arms(0);
  const r = buildControllers([sig('1', [0, -20])], edges, nodes(edges), []);
  expect(r.signals[0].approach).toEqual({ edgeId: 'N', dir: 1, stopAt: 20 });
  const tagged = buildControllers([sig('1', [0, -20], 'backward')], edges, nodes(edges), []);
  expect(tagged.signals[0].approach).toBeUndefined();
  expect(tagged.controllers).toEqual([]);
});

test('direction tags override the junction heuristic', () => {
  const edges = arms();
  const r = buildControllers([sig('1', [0, -20], 'forward')], edges, nodes(edges), []);
  expect(r.signals[0].approach).toEqual({ edgeId: 'N', dir: 1, stopAt: 20 });
});

test('a signal at the node gets every arriving edge, stopped short by the junction trim', () => {
  const edges = arms();
  const ns = nodes(edges);
  const r = buildControllers([sig('c', [0, 0])], edges, ns, []);
  const trims = junctionTrim(ns[0], edges);
  const all = r.controllers[0].phases.flat();
  expect(all).toHaveLength(4);
  for (const a of all) {
    expect(a.dir).toBe(-1);
    expect(a.stopAt).toBe(trims.get(a.edgeId));
  }
  const toNode: GraphEdge = { ...edges[0], id: 'T', from: 'T-start', to: 'c', points: [[0, -60], [0, 0]], nodeIds: ['T-start', 'c'], lanesForward: 2, lanesBackward: 0 };
  const rest = [toNode, ...edges.slice(1)];
  const ns2 = [{ ...ns[0], edges: rest.map(e => e.id) }, { id: 'T-start', position: [0, -60] as [number, number], edges: ['T'] }];
  const a = buildControllers([sig('c', [0, 0])], rest, ns2, []).controllers[0].phases.flat().find(x => x.edgeId === 'T')!;
  expect(a).toEqual({ edgeId: 'T', dir: 1, stopAt: 60 - junctionTrim(ns2[0], rest).get('T')! });
});

test('a signal crossing near a controller links to the first phase without its edge', () => {
  const edges = arms();
  const x = signalCrossing('x', 'N', 30, [0, -30]);
  const r = buildControllers(cross4, edges, nodes(edges), [x]);
  expect(r.controllers).toHaveLength(1);
  expect(r.crossings[0]).toMatchObject({ controllerId: '1', walkPhase: 1 });
});

test('a lone signal crossing gets its own two-phase controller', () => {
  const edges = arms();
  const x = signalCrossing('x', 'N', 30, [0, -30]);
  const r = buildControllers([], edges, nodes(edges), [x]);
  expect(r.controllers).toHaveLength(1);
  const [c] = r.controllers;
  expect(c.id).toBe('ped-x');
  expect(c.phases).toHaveLength(2);
  expect(c.phases[0]).toEqual([{ edgeId: 'N', dir: 1, stopAt: 27 }, { edgeId: 'N', dir: -1, stopAt: 33 }]);
  expect(c.phases[1]).toEqual([]);
  expect(r.crossings[0]).toMatchObject({ controllerId: 'ped-x', walkPhase: 1 });
});

test('two lone signal crossings on one edge each get their own controller', () => {
  const edges = arms();
  const xs = [signalCrossing('x', 'N', 30, [0, -30]), signalCrossing('y', 'N', 50, [0, -50])];
  const r = buildControllers([], edges, nodes(edges), xs);
  expect(r.controllers.map(c => c.id)).toEqual(['ped-x', 'ped-y']);
  expect(r.controllers[1].phases[0]).toEqual([{ edgeId: 'N', dir: 1, stopAt: 47 }, { edgeId: 'N', dir: -1, stopAt: 53 }]);
  expect(r.crossings.map(c => c.controllerId)).toEqual(['ped-x', 'ped-y']);
});

test('a crossing on a single-phase controller adds a pedestrian-only phase', () => {
  const edges = arms();
  const x = signalCrossing('x', 'N', 30, [0, -30]);
  const r = buildControllers([sig('1', [0, -20]), sig('3', [0, 20])], edges, nodes(edges), [x]);
  expect(r.controllers[0].phases).toHaveLength(2);
  expect(r.controllers[0].phases[1]).toEqual([]);
  expect(r.crossings[0].walkPhase).toBe(1);
});

test('offset is deterministic per id and within the cycle', () => {
  const edges = arms();
  const a = buildControllers(cross4, edges, nodes(edges), []).controllers[0];
  const b = buildControllers(cross4, edges, nodes(edges), []).controllers[0];
  expect(a.offset).toBe(b.offset);
  expect(a.offset).toBeGreaterThanOrEqual(0);
  expect(a.offset).toBeLessThan(52);
});
