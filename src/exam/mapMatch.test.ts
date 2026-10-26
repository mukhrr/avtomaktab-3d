import type { DistrictData, GraphEdge, GraphNode, Vec2 } from '../shared/district';
import { LaneNetwork } from '../traffic/lanes';
import { testNetwork } from '../traffic/testNetwork';
import { MapMatcher, type LaneMatch } from './mapMatch';

const DT = 1 / 30;
const EAST = Math.PI / 2;

function matcher(d: DistrictData = testNetwork()) {
  return new MapMatcher(d, new LaneNetwork(d));
}

/** Test network plus a second two-way road 8 m south of the west arm, running parallel to it. */
function withParallel(): DistrictData {
  const d = testNetwork();
  const nodes: GraphNode[] = [
    { id: 'p1', position: [-120, 8], edges: ['par'] },
    { id: 'p2', position: [-20, 8], edges: ['par'] },
  ];
  const par: GraphEdge = {
    id: 'par', from: 'p1', to: 'p2', roadId: 'par', points: [[-120, 8], [-20, 8]], nodeIds: ['p1', 'p2'],
    lanesForward: 1, lanesBackward: 1, width: 7, maxspeed: 30, name: 'par', kind: 'residential',
  };
  d.graph.nodes.push(...nodes);
  d.graph.edges.push(par);
  return d;
}

test('driving east on the west arm matches w toward the cross, 1.75 m right of centre in lane 0', () => {
  const m = matcher().update([-60, 1.75], EAST, DT);
  expect(m.ref).toEqual({ edgeId: 'w', dir: -1, lane: 0 });
  expect(m.lateral).toBeCloseTo(1.75, 2);
  expect(m.edgeS).toBeCloseTo(60, 1);
  expect(m.inJunction).toBeNull();
  expect(m.onConnector).toBe(false);
  expect(m.confidence).toBeGreaterThan(0.5);
});

test('the opposite carriageway matches dir 1', () => {
  const m = matcher().update([-60, -1.75], -EAST, DT);
  expect(m.ref).toEqual({ edgeId: 'w', dir: 1, lane: 0 });
  expect(m.lateral).toBeCloseTo(1.75, 2);
});

test('inside the cross inJunction is the node id and the approach lane is held', () => {
  const m = matcher();
  m.update([-20, 1.75], EAST, DT);
  const inside = m.update([0.5, 0.5], EAST, DT);
  expect(inside.inJunction).toBe('cross');
  expect(inside.onConnector).toBe(true);
  expect(inside.ref).toEqual({ edgeId: 'w', dir: -1, lane: 0 });
});

test('the exit arm is matched on the first frame outside the junction', () => {
  const m = matcher();
  let last: LaneMatch | null = null;
  const seen: string[] = [];
  for (let x = -20; x <= 20; x += 0.5) {
    last = m.update([x, 1.75], EAST, DT);
    seen.push(`${last.ref?.edgeId}:${last.inJunction ?? '-'}`);
  }
  expect(last!.ref).toEqual({ edgeId: 'e', dir: 1, lane: 0 });
  const firstOut = seen.findIndex((s, i) => i > 0 && seen[i - 1].endsWith(':cross') && s.endsWith(':-'));
  expect(seen[firstOut].startsWith('e:')).toBe(true);
  expect(seen.filter(s => s.endsWith(':cross')).every(s => s.startsWith('w:'))).toBe(true);
});

test('straddling the centreline for 0.3 s does not flip dir or edge', () => {
  const m = matcher();
  m.update([-60, 1.5], EAST, DT);
  for (let i = 0; i < 10; i++) {
    const z = 1.5 - 3 * (i / 9);
    const r = m.update([-60 + i * 0.3, z], EAST + (i % 2 ? 0.06 : -0.06), DT);
    expect(r.ref!.edgeId).toBe('w');
    expect(r.ref!.dir).toBe(-1);
  }
});

test('lane index does not chatter on a lane boundary', () => {
  const d = testNetwork();
  d.graph.edges.find(e => e.id === 'w')!.lanesBackward = 2;
  const m = matcher(d);
  // w is 7 m wide with 3 lanes, so the boundary between lanes 0 and 1 (heading east, dir -1: 2 backward lanes) is at 3.5 - 2.333 = 1.17.
  const lanes = new Set<number>();
  for (let i = 0; i < 40; i++) lanes.add(m.update([-60 + i * 0.3, 1.17 + (i % 2 ? 0.05 : -0.05)], EAST, DT).ref!.lane);
  expect(lanes.size).toBe(1);
});

test('heading against a oneway matches the opposite dir so wrong-way is detectable', () => {
  const m = matcher();
  expect(m.update([360, -40], 0, DT).ref).toMatchObject({ edgeId: 'o1', dir: -1 });
  const ok = matcher().update([360, -40], Math.PI, DT);
  expect(ok.ref).toMatchObject({ edgeId: 'o1', dir: 1, lane: 0 });
});

test('a brief drift toward a parallel road never changes the edge, a sustained one does after 0.5 s', () => {
  const m = matcher(withParallel());
  m.update([-80, 1.75], EAST, DT);
  for (let i = 0; i < 9; i++) expect(m.update([-80 + i, 5.5], EAST, DT).ref!.edgeId).toBe('w');
  for (let i = 0; i < 20; i++) expect(m.update([-70 + i, 1.75], EAST, DT).ref!.edgeId).toBe('w');
  const edges: string[] = [];
  for (let i = 0; i < 45; i++) edges.push(m.update([-50 + i * 0.5, 5.5], EAST, DT).ref!.edgeId);
  expect(edges[0]).toBe('w');
  expect(edges.at(-1)).toBe('par');
  expect(edges.filter((e, i) => i && e !== edges[i - 1]).length).toBe(1);
});

test('a car equidistant between two roads, jittering, never flips edge', () => {
  const m = matcher(withParallel());
  m.update([-80, 1.75], EAST, DT);
  const edges: string[] = [];
  for (let i = 0; i < 120; i++) edges.push(m.update([-80 + i * 0.2, 4 + (i % 2 ? 0.1 : -0.1)], EAST, DT).ref!.edgeId);
  expect(new Set(edges).size).toBe(1);
});

test('leaving the road for a moment gives no match, and returning does not invent a new edge', () => {
  const m = matcher();
  m.update([-60, 1.75], EAST, DT);
  const off = m.update([-60, 30], EAST, DT);
  expect(off.ref).toBeNull();
  expect(off.confidence).toBe(0);
  expect(m.update([-58, 1.75], EAST, DT).ref).toEqual({ edgeId: 'w', dir: -1, lane: 0 });
});

test('turning across the road keeps dir until the heading is well past perpendicular', () => {
  const m = matcher();
  m.update([-60, 1.75], EAST, DT);
  for (const h of [EAST, EAST + 0.6, EAST + 1.2, EAST + 1.8]) {
    expect(m.update([-60, 1.75], h, DT).ref!.dir).toBe(-1);
  }
});

/** tE split at (300, 0) by a degree-2 node m. */
function withDegree2(): DistrictData {
  const d = testNetwork();
  const tE = d.graph.edges.find(e => e.id === 'tE')!;
  const mk = (id: string, from: string, to: string, a: Vec2, b: Vec2): GraphEdge =>
    ({ ...tE, id, roadId: id, from, to, points: [a, b], nodeIds: [from, to] });
  d.graph.edges = d.graph.edges.filter(e => e.id !== 'tE').concat(mk('tE1', 't', 'm', [240, 0], [300, 0]), mk('tE2', 'm', 'x', [300, 0], [360, 0]));
  const t = d.graph.nodes.find(n => n.id === 't')!;
  t.edges = t.edges.map(id => (id === 'tE' ? 'tE1' : id));
  const x = d.graph.nodes.find(n => n.id === 'x')!;
  x.edges = x.edges.map(id => (id === 'tE' ? 'tE2' : id));
  d.graph.nodes.push({ id: 'm', position: [300, 0], edges: ['tE1', 'tE2'] });
  return d;
}

test('reversing straight in its own lane keeps ref and the sign of lateral', () => {
  const m = matcher();
  const first = m.update([-100, 1.75], EAST, DT);
  for (let i = 0; i <= 33; i++) {
    const r = m.update([-100 - i * 0.3, 1.75], EAST, DT);
    expect(r.ref).toEqual(first.ref);
    expect(r.lateral).toBeCloseTo(1.75, 2);
  }
});

test('passing a degree-2 node adopts the next edge on the first frame past it', () => {
  const m = matcher(withDegree2());
  let x = 280;
  let r = m.update([x, 1.75], EAST, DT);
  expect(r.ref!.edgeId).toBe('tE1');
  const seen: string[] = [];
  for (; x < 310; x += 0.5) seen.push(m.update([x, 1.75], EAST, DT).ref!.edgeId);
  const at = seen.findIndex(e => e === 'tE2');
  expect(at).toBeGreaterThanOrEqual(0);
  expect(280 + (at + 1) * 0.5).toBeLessThanOrEqual(301);
  expect(seen.slice(at).every(e => e === 'tE2')).toBe(true);
  r = m.update([310, 1.75], EAST, DT);
  expect(r.ref!.edgeId).toBe('tE2');
});
