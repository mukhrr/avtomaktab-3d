import type { DistrictData, GraphEdge, GraphNode, Sign } from '../../src/shared/district';
import { CODE } from '../../src/shared/signCatalogue';
import { ZEBRA_LENGTH } from '../../src/world/crossings';
import { signSpots } from '../../src/world/signMount';
import { edgeLength } from './attach';
import { distanceToPolyline } from './controllers';

export type RuleInput = Pick<DistrictData, 'graph' | 'crossings' | 'controllers' | 'pois'>;

// The plan named 6.4 and 6.1 for these; in the Uzbek catalogue those are vehicle servicing and first aid.
const RULE_CODE = {
  residentialZone: '5.38',
  residentialZoneEnd: '5.39',
  oneWay: '5.5',
  pedestrianCrossingLeft: '5.16.1',
  parking: '5.15',
  hospital: '6.2',
} as const;

const SPEED_AT = 10;
const ZONE_AT = 5;
const ONE_WAY_AT = 10;
const NO_ENTRY_AT = 3;
const PRIORITY_AT = 15;
const SCHOOL_REACH = 60;
const SCHOOL_AHEAD = 75;
const PARKING_REACH = 40;
const HOSPITAL_REACH = 80;
/** Matches JUNCTION_REACH in src/sim/signs.ts: a signal or sign this close to a node governs it. */
const JUNCTION_REACH = 40;
const DIVIDED_GAP = 40;
const DIVIDED_KINDS = new Set(['primary', 'secondary', 'tertiary']);
const MERGE_SPAN = 15;
const MOVE_STEP = 15;
const POLE_CAPACITY = 3;
const UNSIGNED_SPEED = 60;
const KIND_RANK: Record<string, number> = { primary: 5, secondary: 4, tertiary: 3, residential: 2, unclassified: 2, living_street: 1, service: 1 };
const PRIORITY_CODES = new Set<string>([CODE.priorityRoad, CODE.giveWay, CODE.stop]);

const lanes = (e: GraphEdge, dir: 1 | -1) => (dir === 1 ? e.lanesForward : e.lanesBackward);
const directions = (e: GraphEdge) => ([1, -1] as const).filter(dir => lanes(e, dir) > 0);
/** Position `d` metres into the edge for traffic going `dir`. */
const into = (len: number, dir: 1 | -1, d: number) => (dir === 1 ? d : len - d);
const clamp = (v: number, len: number) => Math.min(Math.max(v, 0), len);
const round = (v: number) => Math.round(v * 1000) / 1000;
/** The node a car travelling `dir` arrives at. */
const endNode = (e: GraphEdge, dir: 1 | -1) => (dir === 1 ? e.to : e.from);
const startNode = (e: GraphEdge, dir: 1 | -1) => (dir === 1 ? e.from : e.to);

function sign(rule: string, code: string, e: GraphEdge, dir: 1 | -1, at: number, extra: Partial<Sign> = {}): Sign {
  const a = Math.min(Math.max(round(at), 0), Math.floor(edgeLength(e) * 1000) / 1000);
  return { id: `${rule}-${e.id}-${dir}-${a.toFixed(1)}`, code, edgeId: e.id, dir, at: a, ...extra, origin: 'rule' };
}

class Graph {
  readonly edges = new Map<string, GraphEdge>();
  readonly nodes = new Map<string, GraphNode>();
  private lengths = new Map<string, number>();

  constructor(d: RuleInput) {
    for (const e of d.graph.edges) this.edges.set(e.id, e);
    for (const n of d.graph.nodes) this.nodes.set(n.id, n);
  }

  length(e: GraphEdge): number {
    let l = this.lengths.get(e.id);
    if (l === undefined) this.lengths.set(e.id, (l = edgeLength(e)));
    return l;
  }

  others(nodeId: string, e: GraphEdge): GraphEdge[] {
    return (this.nodes.get(nodeId)?.edges ?? []).filter(id => id !== e.id).map(id => this.edges.get(id)!).filter(Boolean);
  }

  /** Whether `e` has lanes arriving at `nodeId`. */
  arrives(e: GraphEdge, nodeId: string): boolean {
    return (e.to === nodeId && e.lanesForward > 0) || (e.from === nodeId && e.lanesBackward > 0);
  }

  degree(nodeId: string): number {
    return this.nodes.get(nodeId)?.edges.length ?? 0;
  }
}

export function speedSigns(d: RuleInput): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  for (const e of d.graph.edges) {
    if (e.maxspeed === UNSIGNED_SPEED || e.kind === 'living_street' || e.kind === 'service' || !(e.maxspeed > 0)) continue;
    const len = g.length(e);
    if (len < SPEED_AT) continue;
    for (const dir of directions(e)) out.push(sign('speed', CODE.speedLimit, e, dir, into(len, dir, SPEED_AT), { value: e.maxspeed }));
  }
  return out;
}

export function residentialZoneSigns(d: RuleInput): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  const leavesZone = (nodeId: string, e: GraphEdge) => g.others(nodeId, e).some(o => o.kind !== 'living_street');
  for (const e of d.graph.edges) {
    if (e.kind !== 'living_street') continue;
    const len = g.length(e);
    if (len < ZONE_AT) continue;
    for (const dir of directions(e)) {
      if (leavesZone(startNode(e, dir), e)) out.push(sign('zone', RULE_CODE.residentialZone, e, dir, into(len, dir, ZONE_AT)));
      if (leavesZone(endNode(e, dir), e)) out.push(sign('zoneEnd', RULE_CODE.residentialZoneEnd, e, dir, into(len, dir, len - ZONE_AT)));
    }
  }
  return out;
}

const isOneWay = (e: GraphEdge) => e.lanesBackward === 0 && e.lanesForward > 0;

/** One-way major-road edges with a same-named one-way running the other way within 40 m: the two carriageways of a divided road. */
export function dividedCarriageways(d: RuleInput): Set<string> {
  const candidates = d.graph.edges.filter(e => isOneWay(e) && e.name !== '' && DIVIDED_KINDS.has(e.kind.replace(/_link$/, '')));
  const bearing = (e: GraphEdge) => {
    const a = e.points[0], b = e.points[e.points.length - 1];
    return [b[0] - a[0], b[1] - a[1]];
  };
  const near = (a: GraphEdge, b: GraphEdge) =>
    a.points.some(p => distanceToPolyline(b.points, p).dist <= DIVIDED_GAP) || b.points.some(p => distanceToPolyline(a.points, p).dist <= DIVIDED_GAP);
  const out = new Set<string>();
  for (const a of candidates) {
    const [ax, az] = bearing(a);
    for (const b of candidates) {
      if (a === b || a.name !== b.name) continue;
      const [bx, bz] = bearing(b);
      if (ax * bx + az * bz < 0 && near(a, b)) {
        out.add(a.id);
        out.add(b.id);
      }
    }
  }
  return out;
}

export function oneWaySigns(d: RuleInput): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  const divided = dividedCarriageways(d);
  for (const e of d.graph.edges) {
    if (!isOneWay(e) || divided.has(e.id)) continue;
    const len = g.length(e);
    if (g.degree(e.from) >= 3 && len >= ONE_WAY_AT) out.push(sign('oneWay', RULE_CODE.oneWay, e, 1, ONE_WAY_AT));
    // Only where some other road delivers traffic to the end node could a car turn in against the flow.
    if (len >= NO_ENTRY_AT && g.others(e.to, e).some(o => g.arrives(o, e.to))) out.push(sign('noEntry', CODE.noEntry, e, -1, len - NO_ENTRY_AT));
  }
  return out;
}

/** Nodes a non-pedestrian signal controller stops traffic at. */
function signalledNodes(d: RuleInput, g: Graph): Set<string> {
  const out = new Set<string>();
  for (const c of d.controllers) {
    if (c.id.startsWith('ped-')) continue;
    for (const a of c.phases.flat()) {
      const e = g.edges.get(a.edgeId);
      if (!e) continue;
      const left = a.dir === 1 ? g.length(e) - a.stopAt : a.stopAt;
      if (left <= JUNCTION_REACH) out.add(endNode(e, a.dir));
    }
  }
  return out;
}

export function prioritySigns(d: RuleInput): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  const signalled = signalledNodes(d, g);
  const rank = (kind: string) => KIND_RANK[kind.replace(/_link$/, '')] ?? 0;
  for (const n of d.graph.nodes) {
    const arms = [...new Set(n.edges)].map(id => g.edges.get(id)!).filter(Boolean);
    if (arms.length < 3 || signalled.has(n.id)) continue;
    const ranks = arms.map(e => rank(e.kind));
    const top = Math.max(...ranks);
    if (ranks.filter(r => r === top).length !== 2 || arms.every((e, i) => ranks[i] === top || e.kind === 'service')) continue;
    arms.forEach((e, i) => {
      if (ranks[i] < top && e.kind === 'service') return;
      const len = g.length(e);
      const [rule, code] = ranks[i] === top ? ['priority', CODE.priorityRoad] : ['giveWay', CODE.giveWay];
      for (const dir of directions(e)) {
        if (endNode(e, dir) !== n.id) continue;
        out.push(sign(rule, code, e, dir, clamp(into(len, dir, len - PRIORITY_AT), len)));
      }
    });
  }
  return out;
}

export function crossingSigns(d: RuleInput): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  for (const c of d.crossings) {
    const e = g.edges.get(c.edgeId);
    if (c.kind !== 'zebra' || !e) continue;
    const len = g.length(e);
    for (const dir of directions(e)) {
      const at = clamp(c.at - dir * ZEBRA_LENGTH / 2, len);
      out.push(sign('crossing', CODE.pedestrianCrossing, e, dir, at));
      if (lanes(e, dir) >= 2) out.push(sign('crossingLeft', RULE_CODE.pedestrianCrossingLeft, e, dir, at, { side: 'left' }));
    }
  }
  return out;
}

export function poiSigns(d: RuleInput): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  for (const p of d.pois) {
    if (p.kind === 'school' || p.kind === 'kindergarten') {
      for (const e of d.graph.edges) {
        if (e.kind === 'service' || e.kind === 'living_street') continue;
        const hit = distanceToPolyline(e.points, p.position);
        if (hit.dist > SCHOOL_REACH) continue;
        const len = g.length(e);
        for (const dir of directions(e)) out.push(sign('children', CODE.children, e, dir, clamp(hit.at - dir * SCHOOL_AHEAD, len)));
      }
      continue;
    }
    const service = p.kind === 'parking' ? { reach: PARKING_REACH, code: RULE_CODE.parking, rule: 'parking' }
      : p.kind === 'hospital' ? { reach: HOSPITAL_REACH, code: RULE_CODE.hospital, rule: 'hospital' } : null;
    if (!service) continue;
    let best: { e: GraphEdge; dist: number; at: number } | null = null;
    for (const e of d.graph.edges) {
      if (e.kind === 'service') continue;
      const hit = distanceToPolyline(e.points, p.position);
      if (hit.dist <= service.reach && (!best || hit.dist < best.dist)) best = { e, ...hit };
    }
    if (best) for (const dir of directions(best.e)) out.push(sign(service.rule, service.code, best.e, dir, best.at));
  }
  return out;
}

const RULES: [string, (d: RuleInput) => Sign[]][] = [
  ['speed', speedSigns], ['residential zone', residentialZoneSigns], ['one way', oneWaySigns],
  ['priority', prioritySigns], ['crossing', crossingSigns], ['children, parking, hospital', poiSigns],
];

/**
 * Hand signs first, then each rule's signs where they do not clash, then coverage signs under the same rules;
 * see the M5b plan for the merge rules.
 */
export function placeRuleSigns(d: RuleInput, hand: Sign[], log: (m: string) => void = () => {}, coverage: Sign[] = []): Sign[] {
  const g = new Graph(d);
  const curbKey = (s: Sign) => `${s.edgeId}|${s.dir}|${s.side ?? 'right'}`;
  const byCurb = new Map<string, Sign[]>();
  const add = (s: Sign) => byCurb.set(curbKey(s), [...(byCurb.get(curbKey(s)) ?? []), s]);
  hand.forEach(add);

  const handPriorityNodes = new Set<string>();
  for (const s of hand) {
    const e = g.edges.get(s.edgeId);
    if (!e || !PRIORITY_CODES.has(s.code)) continue;
    if ((s.dir === 1 ? g.length(e) - s.at : s.at) <= JUNCTION_REACH) handPriorityNodes.add(endNode(e, s.dir));
  }

  const merged = [...hand];
  const mergeAll = (name: string, candidates: Sign[], shift: (s: Sign, e: GraphEdge, at: number) => Sign) => {
    let placed = 0, absorbed = 0, moved = 0, dropped = 0, deferred = 0;
    for (const candidate of candidates) {
      const e = g.edges.get(candidate.edgeId)!;
      if (candidate.origin === 'rule' && (candidate.code === CODE.priorityRoad || candidate.code === CODE.giveWay) && handPriorityNodes.has(endNode(e, candidate.dir))) {
        deferred++;
        continue;
      }
      const curb = byCurb.get(curbKey(candidate)) ?? [];
      const same = curb.find(s => s.code === candidate.code && Math.abs(s.at - candidate.at) <= MERGE_SPAN);
      if (same) {
        absorbed++;
        if (candidate.origin === 'coverage') log(`coverage sign ${candidate.id} absorbed by ${same.id}, the same code within ${MERGE_SPAN} m`);
        continue;
      }
      const overfull = (s: Sign) => signSpots([...curb, s]).some(spot => spot.signs.length > POLE_CAPACITY);
      let s = candidate;
      if (overfull(s)) {
        const at = s.at + s.dir * MOVE_STEP;
        const shifted = shift(s, e, at);
        if (at < 0 || at > g.length(e) || overfull(shifted)) {
          dropped++;
          log(`${candidate.origin} sign ${candidate.id} dropped: its pole is full and ${MOVE_STEP} m on is ${at < 0 || at > g.length(e) ? 'off the edge' : 'full too'}`);
          continue;
        }
        s = shifted;
        moved++;
      }
      add(s);
      merged.push(s);
      placed++;
    }
    log(`${name} signs: ${placed} placed (${moved} moved), ${absorbed} already signed, ${dropped} dropped${deferred ? `, ${deferred} left to hand signs` : ''}`);
  };

  const shiftRule = (s: Sign, e: GraphEdge, at: number) => {
    const carry = { ...(s.value !== undefined && { value: s.value }), ...(s.side && { side: s.side }) };
    return sign(s.id.slice(0, s.id.indexOf('-')), s.code, e, s.dir, at, carry);
  };
  for (const [name, rule] of RULES) mergeAll(name, rule(d), shiftRule);
  if (coverage.length) mergeAll('coverage', coverage, (s, _e, at) => ({ ...s, at: round(at) }));
  return merged;
}
