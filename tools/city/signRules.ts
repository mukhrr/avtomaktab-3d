import type { DistrictData, GraphEdge, GraphNode, Sign, Vec2 } from '../../src/shared/district';
import { CODE } from '../../src/shared/signCatalogue';
import { ZEBRA_LENGTH } from '../../src/world/crossings';
import { JUNCTION_REACH } from '../../src/sim/signs';
import { LaneNetwork } from '../../src/traffic/lanes';
import { junctionPolygon } from '../../src/world/roadGeometry';
import { signPose, signSpots } from '../../src/world/signMount';
import { edgeLength } from './attach';
import { distanceToPolyline } from './controllers';

export type RuleInput = Pick<DistrictData, 'graph' | 'crossings' | 'controllers' | 'pois'>;
type Log = (m: string) => void;

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
const DIVIDED_GAP = 40;
const DIVIDED_KINDS = new Set(['primary', 'secondary', 'tertiary']);
const MERGE_SPAN = 15;
const MOVE_STEP = 15;
const POLE_CAPACITY = 3;
const UNSIGNED_SPEED = 60;
/** How far a pole may slide away from its spot to clear a junction or another road's carriageway. */
const END_SLACK = 10;
const CROSSING_SLACK = 3;
/** The shortest stretch of lane between two junction mouths that still takes a priority sign's pole. */
const MIN_POLE_SPAN = 2;
/** A kerbside pole may graze the edge line of a road meeting at a shallow angle by this much. */
const GRAZE = 0.5;
const KIND_RANK: Record<string, number> = { primary: 5, secondary: 4, tertiary: 3, residential: 2, unclassified: 2, living_street: 1, service: 1 };
const PRIORITY_CODES = new Set<string>([CODE.priorityRoad, CODE.giveWay, CODE.stop]);

type Box = [number, number, number, number];
const box = (pts: Vec2[], pad: number): Box => [
  Math.min(...pts.map(p => p[0])) - pad, Math.min(...pts.map(p => p[1])) - pad, Math.max(...pts.map(p => p[0])) + pad, Math.max(...pts.map(p => p[1])) + pad,
];
const inBox = ([x0, z0, x1, z1]: Box, [x, z]: Vec2) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
function insidePolygon([x, z]: Vec2, p: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
const range = (n: number) => Array.from({ length: n + 1 }, (_, k) => k);

const lanes = (e: GraphEdge, dir: 1 | -1) => (dir === 1 ? e.lanesForward : e.lanesBackward);
const directions = (e: GraphEdge) => ([1, -1] as const).filter(dir => lanes(e, dir) > 0);
/** Position `d` metres into the edge for traffic going `dir`. */
const into = (len: number, dir: 1 | -1, d: number) => (dir === 1 ? d : len - d);
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
  private readonly net: LaneNetwork;

  constructor(d: RuleInput) {
    for (const e of d.graph.edges) this.edges.set(e.id, e);
    for (const n of d.graph.nodes) this.nodes.set(n.id, n);
    this.net = new LaneNetwork(d);
  }

  length(e: GraphEdge): number {
    let l = this.lengths.get(e.id);
    if (l === undefined) this.lengths.set(e.id, (l = edgeLength(e)));
    return l;
  }

  /** Metres travelled in `dir` where the lane leaves the start junction and meets the end one; poles outside stand in a crossing road. */
  span(e: GraphEdge, dir: 1 | -1): [number, number] {
    const p = this.net.path({ edgeId: e.id, dir, lane: 0 }), len = this.length(e);
    return [into(len, dir, p.startAt), into(len, dir, p.endAt)];
  }

  /**
   * Edge position `fromStart` metres past the start junction, or `fromEnd` metres before the end one (with `clamp`, as
   * near as the lane allows), or `travelled` clamped between them, slid up to `slack` metres (away from the junction it is measured from) until the pole stands
   * clear of junctions and other roads; null with a log line when there is no such spot on the lane.
   */
  place(
    e: GraphEdge, dir: 1 | -1, what: string, log: Log,
    at: { fromStart?: number; fromEnd?: number; travelled?: number },
    { side = 'right' as 'right' | 'left', slack = END_SLACK, clamp = false } = {},
  ): number | null {
    const [lo, hi] = this.span(e, dir);
    let t0 = at.fromStart !== undefined ? lo + at.fromStart : at.fromEnd !== undefined ? hi - at.fromEnd : Math.min(Math.max(at.travelled!, lo), hi);
    if (clamp && hi - lo >= MIN_POLE_SPAN) t0 = Math.min(Math.max(t0, lo), hi);
    if (t0 < lo || t0 > hi) {
      log(`${what} on ${e.id} dir ${dir} dropped: ${(hi - lo).toFixed(1)} m between the junctions is too short`);
      return null;
    }
    const steps = at.fromStart !== undefined ? range(slack).map(k => k) : at.fromEnd !== undefined ? range(slack).map(k => -k) : range(slack).flatMap(k => (k ? [k, -k] : [0]));
    for (const k of steps) {
      const t = t0 + k;
      if (t < lo || t > hi) continue;
      const a = into(this.length(e), dir, t);
      if (this.clear(e, dir, side, a)) return a;
    }
    log(`${what} on ${e.id} dir ${dir} dropped: no spot within ${slack} m clear of junctions and other roads`);
    return null;
  }

  private obstacles: { polys: { box: Box; poly: Vec2[] }[]; roads: { box: Box; e: GraphEdge }[] } | null = null;

  private clear(e: GraphEdge, dir: 1 | -1, side: 'right' | 'left', at: number): boolean {
    this.obstacles ??= {
      polys: [...this.nodes.values()].filter(n => n.edges.length >= 3).map(n => {
        const poly = junctionPolygon(n, n.edges.map(id => this.edges.get(id)!).filter(Boolean));
        return { poly, box: box(poly, 0) };
      }),
      roads: [...this.edges.values()].map(o => ({ e: o, box: box(o.points, o.width / 2) })),
    };
    const p = signPose(e, { id: '', code: '', edgeId: e.id, dir, at, side, origin: 'rule' });
    const pt: Vec2 = [p.x, p.z];
    if (this.obstacles.polys.some(j => inBox(j.box, pt) && insidePolygon(pt, j.poly))) return false;
    return !this.obstacles.roads.some(r => r.e !== e && inBox(r.box, pt) && distanceToPolyline(r.e.points, pt).dist < r.e.width / 2 - GRAZE);
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

export function speedSigns(d: RuleInput, log: Log = () => {}): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  for (const e of d.graph.edges) {
    if (e.maxspeed === UNSIGNED_SPEED || e.kind === 'living_street' || e.kind === 'service' || !(e.maxspeed > 0)) continue;
    if (g.length(e) < SPEED_AT) continue;
    for (const dir of directions(e)) {
      const at = g.place(e, dir, `speed limit ${e.maxspeed}`, log, { fromStart: SPEED_AT });
      if (at !== null) out.push(sign('speed', CODE.speedLimit, e, dir, at, { value: e.maxspeed }));
    }
  }
  return out;
}

/** 5.38 where a chain of living streets is entered from another road, 5.39 where it is left; nothing between its blocks. */
export function residentialZoneSigns(d: RuleInput, log: Log = () => {}): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  const living = (e: GraphEdge) => e.kind === 'living_street';
  const chainEnd = (nodeId: string, e: GraphEdge) => {
    const others = g.others(nodeId, e);
    return !others.some(living) && others.length > 0;
  };
  for (const e of d.graph.edges) {
    if (!living(e) || g.length(e) < ZONE_AT) continue;
    for (const dir of directions(e)) {
      if (chainEnd(startNode(e, dir), e)) {
        const at = g.place(e, dir, 'residential zone', log, { fromStart: ZONE_AT });
        if (at !== null) out.push(sign('zone', RULE_CODE.residentialZone, e, dir, at));
      }
      if (chainEnd(endNode(e, dir), e)) {
        const at = g.place(e, dir, 'end of residential zone', log, { fromEnd: ZONE_AT });
        if (at !== null) out.push(sign('zoneEnd', RULE_CODE.residentialZoneEnd, e, dir, at));
      }
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

export function oneWaySigns(d: RuleInput, log: Log = () => {}): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  const divided = dividedCarriageways(d);
  for (const e of d.graph.edges) {
    if (!isOneWay(e) || divided.has(e.id)) continue;
    const len = g.length(e);
    if (g.degree(e.from) >= 3 && len >= ONE_WAY_AT) {
      const at = g.place(e, 1, 'one way', log, { fromStart: ONE_WAY_AT });
      if (at !== null) out.push(sign('oneWay', RULE_CODE.oneWay, e, 1, at));
    }
    // Only where some other road delivers traffic to the end node could a car turn in against the flow.
    if (len >= NO_ENTRY_AT && g.others(e.to, e).some(o => g.arrives(o, e.to))) {
      const at = g.place(e, -1, 'no entry', log, { fromStart: NO_ENTRY_AT });
      if (at !== null) out.push(sign('noEntry', CODE.noEntry, e, -1, at));
    }
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

export function prioritySigns(d: RuleInput, log: Log = () => {}): Sign[] {
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
      const [rule, code] = ranks[i] === top ? ['priority', CODE.priorityRoad] : ['giveWay', CODE.giveWay];
      for (const dir of directions(e)) {
        if (endNode(e, dir) !== n.id) continue;
        // A junction keeps its priority sign on a short approach; 15 m back is where it stands when there is room.
        const at = g.place(e, dir, `${code} at ${n.id}`, log, { fromEnd: PRIORITY_AT }, { clamp: true });
        if (at !== null) out.push(sign(rule, code, e, dir, at));
      }
    });
  }
  return out;
}

export function crossingSigns(d: RuleInput, log: Log = () => {}): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  for (const c of d.crossings) {
    const e = g.edges.get(c.edgeId);
    if (c.kind !== 'zebra' || !e) continue;
    const len = g.length(e);
    for (const dir of directions(e)) {
      // 5.16.2 at the crossing's near boundary, 5.16.1 at its far one.
      const near = g.place(e, dir, `crossing ${c.id}`, log, { travelled: into(len, dir, c.at - dir * ZEBRA_LENGTH / 2) }, { slack: CROSSING_SLACK });
      if (near !== null) out.push(sign('crossing', CODE.pedestrianCrossing, e, dir, near));
      if (lanes(e, dir) < 2) continue;
      const far = g.place(e, dir, `crossing ${c.id}`, log, { travelled: into(len, dir, c.at + dir * ZEBRA_LENGTH / 2) }, { side: 'left', slack: CROSSING_SLACK });
      if (far !== null) out.push(sign('crossingLeft', RULE_CODE.pedestrianCrossingLeft, e, dir, far, { side: 'left' }));
    }
  }
  return out;
}

export function poiSigns(d: RuleInput, log: Log = () => {}): Sign[] {
  const g = new Graph(d), out: Sign[] = [];
  for (const p of d.pois) {
    if (p.kind === 'school' || p.kind === 'kindergarten') {
      for (const e of d.graph.edges) {
        if (e.kind === 'service' || e.kind === 'living_street') continue;
        const hit = distanceToPolyline(e.points, p.position);
        if (hit.dist > SCHOOL_REACH) continue;
        const len = g.length(e);
        for (const dir of directions(e)) {
          const at = g.place(e, dir, `children ${p.id}`, log, { travelled: into(len, dir, hit.at - dir * SCHOOL_AHEAD) });
          if (at !== null) out.push(sign('children', CODE.children, e, dir, at));
        }
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
    if (!best) continue;
    const len = g.length(best.e);
    for (const dir of directions(best.e)) {
      const at = g.place(best.e, dir, `${service.rule} ${p.id}`, log, { travelled: into(len, dir, best.at) });
      if (at !== null) out.push(sign(service.rule, service.code, best.e, dir, at));
    }
  }
  return out;
}

const RULES: [string, (d: RuleInput, log: Log) => Sign[]][] = [
  ['speed', speedSigns], ['residential zone', residentialZoneSigns], ['one way', oneWaySigns],
  ['priority', prioritySigns], ['crossing', crossingSigns], ['children, parking, hospital', poiSigns],
];

/**
 * Hand signs first, then each rule's signs where they do not clash, then coverage signs under the same rules;
 * see the M5b plan for the merge rules.
 */
export function placeRuleSigns(d: RuleInput, hand: Sign[], log: Log = () => {}, coverage: Sign[] = []): Sign[] {
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
      const sameCode = (c: Sign) => curb.find(s => s.code === c.code && Math.abs(s.at - c.at) <= MERGE_SPAN);
      const absorb = (c: Sign, same: Sign) => {
        absorbed++;
        if (candidate.origin === 'coverage') log(`coverage sign ${c.id} absorbed by ${same.id}, the same code within ${MERGE_SPAN} m`);
      };
      const same = sameCode(candidate);
      if (same) {
        absorb(candidate, same);
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
        const sameThere = sameCode(shifted);
        if (sameThere) {
          absorb(shifted, sameThere);
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
  for (const [name, rule] of RULES) mergeAll(name, rule(d, log), shiftRule);
  if (coverage.length) mergeAll('coverage', coverage, (s, _e, at) => ({ ...s, at: round(at) }));
  return merged;
}
