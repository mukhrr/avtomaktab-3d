import type { GraphEdge, GraphNode, Sign, Vec2 } from '../../src/shared/district';
import {
  crossingSigns, oneWaySigns, placeRuleSigns, poiSigns, prioritySigns, residentialZoneSigns, speedSigns, type RuleInput,
} from './signRules';

const POS: Record<string, Vec2> = {
  A: [0, 0], B: [100, 0], C: [200, 0], D: [300, 0], J: [100, 0], N: [100, -100], S: [100, 100], E: [200, 0], F: [200, 100],
};

const edge = (id: string, from: string, to: string, o: Partial<GraphEdge> = {}): GraphEdge => ({
  id, from, to, roadId: id, points: [POS[from], POS[to]], nodeIds: [from, to],
  lanesForward: 1, lanesBackward: 1, width: 7, maxspeed: 60, name: '', kind: 'residential', ...o,
});

function input(edges: GraphEdge[], extra: Partial<RuleInput> = {}): RuleInput {
  const nodes = new Map<string, GraphNode>();
  for (const e of edges) {
    for (const id of [e.from, e.to]) {
      const n = nodes.get(id) ?? { id, position: POS[id], edges: [] };
      if (!n.edges.includes(e.id)) n.edges.push(e.id);
      nodes.set(id, n);
    }
  }
  return { graph: { nodes: [...nodes.values()], edges }, crossings: [], controllers: [], pois: [], ...extra };
}

const pick = (signs: Sign[]) => signs.map(s => ({ code: s.code, edgeId: s.edgeId, dir: s.dir, at: s.at, side: s.side ?? 'right' }));
const hand = (code: string, at: number, o: Partial<Sign> = {}): Sign => ({ id: `h-${code}-${at}`, code, edgeId: 'e', dir: 1, at, origin: 'hand', ...o });

describe('rule signs', () => {
  it('puts a speed limit after the start of each non-60 edge, both directions', () => {
    const signs = speedSigns(input([edge('e', 'A', 'B', { maxspeed: 40 })]));
    expect(signs.map(s => [s.code, s.value, s.dir, s.at])).toEqual([['3.24', 40, 1, 10], ['3.24', 40, -1, 90]]);
    expect(signs.every(s => s.origin === 'rule')).toBe(true);
  });

  it('places no speed sign on 60 km/h roads', () => {
    expect(speedSigns(input([edge('e', 'A', 'B')]))).toEqual([]);
  });

  it('places no speed sign on living streets or service roads', () => {
    expect(speedSigns(input([edge('e', 'A', 'B', { maxspeed: 20, kind: 'service' }), edge('f', 'B', 'C', { maxspeed: 20, kind: 'living_street' })]))).toEqual([]);
  });

  it('brackets a living street with 5.38 and 5.39', () => {
    const d = input([edge('r1', 'A', 'B'), edge('ls', 'B', 'C', { kind: 'living_street' }), edge('r2', 'C', 'D')]);
    expect(pick(residentialZoneSigns(d))).toEqual([
      { code: '5.38', edgeId: 'ls', dir: 1, at: 5, side: 'right' },
      { code: '5.39', edgeId: 'ls', dir: 1, at: 95, side: 'right' },
      { code: '5.38', edgeId: 'ls', dir: -1, at: 95, side: 'right' },
      { code: '5.39', edgeId: 'ls', dir: -1, at: 5, side: 'right' },
    ]);
  });

  it('does not bracket the join between two living streets', () => {
    const d = input([edge('l1', 'A', 'B', { kind: 'living_street' }), edge('l2', 'B', 'C', { kind: 'living_street' })]);
    expect(residentialZoneSigns(d)).toEqual([]);
  });

  it('starts a one-way edge with 5.5 and ends it with 3.1 facing against the flow', () => {
    const d = input([
      edge('a', 'A', 'J'), edge('n', 'N', 'J'), edge('ow', 'J', 'E', { lanesBackward: 0 }), edge('c', 'E', 'D'), edge('x', 'F', 'E'),
    ]);
    expect(pick(oneWaySigns(d))).toEqual([
      { code: '5.5', edgeId: 'ow', dir: 1, at: 10, side: 'right' },
      { code: '3.1', edgeId: 'ow', dir: -1, at: 97, side: 'right' },
    ]);
  });

  it('puts no 3.1 where the one-way only continues into another one-way', () => {
    const signs = oneWaySigns(input([edge('ow', 'A', 'B', { lanesBackward: 0 }), edge('ow2', 'B', 'C', { lanesBackward: 0 })]));
    expect(signs.filter(s => s.code === '3.1')).toEqual([]);
  });

  const tee = () => [
    edge('p1', 'A', 'J', { kind: 'primary' }), edge('p2', 'J', 'C', { kind: 'primary' }), edge('r', 'S', 'J', { kind: 'residential' }),
  ];

  it('gives the major road 2.1 and the minor approaches 2.4 at an unsignalled junction', () => {
    expect(pick(prioritySigns(input(tee()))).sort((a, b) => a.edgeId.localeCompare(b.edgeId))).toEqual([
      { code: '2.1', edgeId: 'p1', dir: 1, at: 85, side: 'right' },
      { code: '2.1', edgeId: 'p2', dir: -1, at: 15, side: 'right' },
      { code: '2.4', edgeId: 'r', dir: 1, at: 85, side: 'right' },
    ]);
  });

  it('ranks a _link road as its base kind', () => {
    const d = input([edge('p1', 'A', 'J', { kind: 'primary' }), edge('p2', 'J', 'C', { kind: 'primary_link' }), edge('r', 'S', 'J')]);
    expect(prioritySigns(d).map(s => s.code).sort()).toEqual(['2.1', '2.1', '2.4']);
  });

  it('puts no priority signs where all approaches rank equal', () => {
    expect(prioritySigns(input([edge('p1', 'A', 'J'), edge('p2', 'J', 'C'), edge('r', 'S', 'J')]))).toEqual([]);
  });

  it('skips signalled junctions', () => {
    const controllers = [{ id: '7', phases: [[{ edgeId: 'p1', dir: 1 as const, stopAt: 95 }]], offset: 0 }];
    expect(prioritySigns(input(tee(), { controllers }))).toEqual([]);
  });

  it('does not treat a mid-block pedestrian signal as a signalled junction', () => {
    const controllers = [{ id: 'ped-9', phases: [[{ edgeId: 'p1', dir: 1 as const, stopAt: 47 }, { edgeId: 'p1', dir: -1 as const, stopAt: 53 }], []], offset: 0 }];
    expect(prioritySigns(input(tee(), { controllers }))).toHaveLength(3);
  });

  it('marks a zebra with 5.16.2, and 5.16.1 on multi-lane directions', () => {
    const crossings = [{ id: 'z', position: [50, 0] as Vec2, kind: 'zebra' as const, edgeId: 'e', at: 50, width: 7 }];
    const signs = crossingSigns(input([edge('e', 'A', 'B', { lanesForward: 2 })], { crossings }));
    expect(pick(signs)).toEqual([
      { code: '5.16.2', edgeId: 'e', dir: 1, at: 48.5, side: 'right' },
      { code: '5.16.1', edgeId: 'e', dir: 1, at: 48.5, side: 'left' },
      { code: '5.16.2', edgeId: 'e', dir: -1, at: 51.5, side: 'right' },
    ]);
  });

  it('ignores unmarked and signal crossings', () => {
    const crossings = [{ id: 'z', position: [50, 0] as Vec2, kind: 'unmarked' as const, edgeId: 'e', at: 50, width: 7 }];
    expect(crossingSigns(input([edge('e', 'A', 'B')], { crossings }))).toEqual([]);
  });

  it('warns of children 75 m before a school', () => {
    const pois = [{ id: 's', kind: 'school' as const, position: [180, 30] as Vec2 }, { id: 'k', kind: 'kindergarten' as const, position: [30, 300] as Vec2 }];
    expect(pick(poiSigns(input([edge('e', 'A', 'C')], { pois })))).toEqual([
      { code: '1.21', edgeId: 'e', dir: 1, at: 105, side: 'right' },
      { code: '1.21', edgeId: 'e', dir: -1, at: 200, side: 'right' },
    ]);
  });

  it('marks a car park and a hospital on the nearest non-service road', () => {
    const pois = [{ id: 'p', kind: 'parking' as const, position: [50, 20] as Vec2 }, { id: 'h', kind: 'hospital' as const, position: [150, 70] as Vec2 }];
    const d = input([edge('e', 'A', 'C', { points: [[0, 0], [200, 0]] }), edge('srv', 'N', 'J', { kind: 'service', points: [[0, 10], [200, 10]] })], { pois });
    expect(pick(poiSigns(d))).toEqual([
      { code: '5.15', edgeId: 'e', dir: 1, at: 50, side: 'right' },
      { code: '5.15', edgeId: 'e', dir: -1, at: 50, side: 'right' },
      { code: '6.2', edgeId: 'e', dir: 1, at: 150, side: 'right' },
      { code: '6.2', edgeId: 'e', dir: -1, at: 150, side: 'right' },
    ]);
  });

  it('keeps a hand sign and drops the rule sign of the same code within 15 m', () => {
    const d = input([edge('e', 'A', 'B', { maxspeed: 40 })]);
    const out = placeRuleSigns(d, [hand('3.24', 20, { value: 40 })]);
    expect(pick(out)).toEqual([
      { code: '3.24', edgeId: 'e', dir: 1, at: 20, side: 'right' },
      { code: '3.24', edgeId: 'e', dir: -1, at: 90, side: 'right' },
    ]);
    expect(out[0].origin).toBe('hand');
  });

  it('keeps the first of two rule signs of the same code within 15 m', () => {
    const pois = [{ id: 's1', kind: 'school' as const, position: [20, 30] as Vec2 }, { id: 's2', kind: 'school' as const, position: [25, 30] as Vec2 }];
    const out = placeRuleSigns(input([edge('e', 'A', 'B')], { pois }), []);
    expect(out.filter(s => s.dir === 1).map(s => s.code)).toEqual(['1.21']);
  });

  it('moves a rule sign 15 m on when its spot already holds 3 signs', () => {
    const d = input([edge('e', 'A', 'B', { maxspeed: 40 })]);
    const out = placeRuleSigns(d, [hand('1.21', 10), hand('3.19', 10), hand('3.18.2', 10)]);
    expect(out.find(s => s.code === '3.24' && s.dir === 1)?.at).toBe(25);
  });

  it('drops and logs a rule sign that would move off the edge', () => {
    const d = input([edge('e', 'A', 'B', { maxspeed: 40, points: [[0, 0], [20, 0]] })]);
    const log: string[] = [];
    const out = placeRuleSigns(d, [hand('1.21', 10), hand('3.19', 10), hand('3.18.2', 10)], m => log.push(m));
    expect(out.filter(s => s.code === '3.24').map(s => s.dir)).toEqual([-1]);
    expect(log.filter(m => m.includes('speed-e-1-10.0'))).toHaveLength(1);
  });

  it('defers to hand priority signs at the same junction', () => {
    const out = placeRuleSigns(input(tee()), [hand('2.5', 90, { edgeId: 'r' })]);
    expect(out.filter(s => s.origin === 'rule' && ['2.1', '2.4'].includes(s.code))).toEqual([]);
  });

  it('gives rule signs stable ids', () => {
    const crossings = [{ id: 'z', position: [50, 0] as Vec2, kind: 'zebra' as const, edgeId: 'p1', at: 50, width: 7 }];
    const d = input(tee().map(e => ({ ...e, maxspeed: 50, kind: e.kind === 'primary' ? 'primary' : 'residential' })), { crossings });
    const a = placeRuleSigns(d, []).map(s => s.id), b = placeRuleSigns(d, []).map(s => s.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(a).toContain('speed-p1-1-10.0');
    expect(a).toContain('priority-p1-1-85.0');
  });
});
