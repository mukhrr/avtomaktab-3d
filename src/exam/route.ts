import type { DistrictData, GraphEdge, Vec2 } from '../shared/district';
import { pointAt, type LaneNetwork, type LaneRef } from '../traffic/lanes';
import { nearestLane } from '../world/spawn';

export type Maneuver = 'start' | 'straight' | 'left' | 'right' | 'uturn' | 'finish';

export interface RouteStep {
  /** Lane is always 0 and not prescriptive: lane choice is judged from the player's real lane. */
  ref: LaneRef;
  /** What happens at the end of this lane: the turn into the next step. */
  maneuver: Maneuver;
  /** Junction at the end of this lane; null only on the finish step. */
  nodeId: string | null;
  /** Index into `ExamRoute.waypoints` of the next waypoint this step leads toward. */
  waypointIndex: number;
}

export interface RouteFeatures {
  signalledLeft: number;
  signalledRight: number;
  signalledStraight: number;
  unsignalledPriorityRight: number;
  zebras: number;
  signalCrossings: number;
  multiLaneTurns: number;
  speedZones: number;
  stopSigns: number;
  giveWaySigns: number;
}

export interface Pose {
  position: Vec2;
  heading: number;
}

export interface ExamRoute {
  id: string;
  district: string;
  waypoints: Vec2[];
  start: Pose;
  finish: Pose;
  /** Can revisit the same edge and direction (route-1 does), so progress must use a forward-only cursor. */
  steps: RouteStep[];
  lengthM: number;
  features: RouteFeatures;
}

const TURN_COST = 15;
/** Yards and living streets are for reaching the start or finish, not for driving through. */
const MINOR_KINDS = new Set(['service', 'living_street']);
const MINOR_FACTOR = 3;
const KIND_RANK: Record<string, number> = {
  motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2, unclassified: 1, residential: 1,
};
const rank = (kind: string) => KIND_RANK[kind.replace(/_link$/, '')] ?? 0;
const SIGNAL_REACH = 40;
const PED_CONTROLLER = 'ped-';

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const laneKey = (r: LaneRef) => `${r.edgeId}|${r.dir}|${r.lane}`;
const approachKey = (r: { edgeId: string; dir: number }) => `${r.edgeId}|${r.dir}`;

export function classifyTurn(fromHeading: number, toHeading: number): Exclude<Maneuver, 'start' | 'finish'> {
  const delta = wrapAngle(toHeading - fromHeading);
  const abs = Math.abs(delta);
  if (abs < Math.PI / 6) return 'straight';
  if (abs > (5 * Math.PI) / 6) return 'uturn';
  // Heading is atan2(dx, dz) with x east and z south, so turning right decreases it.
  return delta < 0 ? 'right' : 'left';
}

/** Distance along a polyline to the point closest to `p`. */
function project(points: Vec2[], p: Vec2): number {
  let best = Infinity, at = 0, run = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (len * len))) : 0;
    const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
    if (d < best) {
      best = d;
      at = run + t * len;
    }
    run += len;
  }
  return at;
}

const endHeading = (pts: Vec2[]) => {
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  return Math.atan2(b[0] - a[0], b[1] - a[1]);
};
const startHeading = (pts: Vec2[]) => Math.atan2(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);

export function turnBetween(net: LaneNetwork, from: LaneRef, to: LaneRef): Exclude<Maneuver, 'start' | 'finish'> {
  return classifyTurn(endHeading(net.path(from).points), startHeading(net.path(to).points));
}

/** The lane a waypoint stands on (right-hand traffic: the side of the street picks the direction) and how far along it. */
export function snapWaypoint(net: LaneNetwork, d: DistrictData, p: Vec2): { ref: LaneRef; s: number } {
  const lane = nearestLane(d, p[0], p[1]);
  if (!lane) throw new Error(`no road near (${p[0]}, ${p[1]})`);
  const e = lane.edge;
  let dir: 1 | -1;
  if (e.lanesBackward === 0) dir = 1;
  else if (e.lanesForward === 0) dir = -1;
  else {
    const s = project(e.points, p);
    const { position, heading } = pointAt(e.points, s);
    const right = -Math.cos(heading) * (p[0] - position[0]) + Math.sin(heading) * (p[1] - position[1]);
    dir = right >= 0 ? 1 : -1;
  }
  const ref: LaneRef = { edgeId: e.id, dir, lane: 0 };
  return { ref, s: project(net.path(ref).points, p) };
}

/** Lanes after `source` up to the first lane on the target edge and direction, cheapest by length plus turns. */
function search(
  net: LaneNetwork, source: LaneRef, target: { edgeId: string; dir: number }, minor: Set<string>,
): LaneRef[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const refs = new Map<string, LaneRef>();
  const done = new Set<string>();
  const relax = (from: LaneRef, base: number, parent: string | null) => {
    for (const next of net.exits(from)) {
      const k = laneKey(next);
      if (done.has(k)) continue;
      const len = net.path(next).length * (minor.has(next.edgeId) && next.edgeId !== target.edgeId ? MINOR_FACTOR : 1);
      const cost = base + len + (turnBetween(net, from, next) === 'straight' ? 0 : TURN_COST);
      if (cost < (dist.get(k) ?? Infinity)) {
        dist.set(k, cost);
        prev.set(k, parent);
        refs.set(k, next);
      }
    }
  };
  relax(source, 0, null);
  for (;;) {
    let k: string | null = null, best = Infinity;
    for (const [key, v] of dist) if (!done.has(key) && v < best) [k, best] = [key, v];
    if (k === null) return null;
    done.add(k);
    const ref = refs.get(k)!;
    if (ref.edgeId === target.edgeId && ref.dir === target.dir) {
      const out: LaneRef[] = [];
      for (let c: string | null = k; c !== null; c = prev.get(c)!) out.unshift(refs.get(c)!);
      return out;
    }
    relax(ref, best, k);
  }
}

export function planRoute(net: LaneNetwork, d: DistrictData, waypoints: Vec2[], id = 'route', district = d.name): ExamRoute {
  if (waypoints.length < 2) throw new Error('a route needs at least two waypoints');
  const snaps = waypoints.map(p => snapWaypoint(net, d, p));
  const kinds = new Map(d.roads.map(r => [r.id, r.kind]));
  const minor = new Set(d.graph.edges.filter(e => MINOR_KINDS.has(kinds.get(e.roadId) ?? '')).map(e => e.id));
  const refs: LaneRef[] = [snaps[0].ref];
  const leadsTo: number[] = [1];
  let s = snaps[0].s;
  for (let k = 1; k < waypoints.length; k++) {
    const cur = refs[refs.length - 1], want = snaps[k];
    const sameLane = cur.edgeId === want.ref.edgeId && cur.dir === want.ref.dir;
    if (!(sameLane && want.s >= s)) {
      const found = search(net, cur, want.ref, minor);
      if (!found) throw new Error(`waypoint ${k} (${waypoints[k].join(', ')}) is unreachable`);
      for (const r of found) {
        refs.push(r);
        leadsTo.push(k);
      }
    }
    // The lane holding waypoint k already leads on toward k + 1.
    if (k < waypoints.length - 1) leadsTo[leadsTo.length - 1] = k + 1;
    s = refs[refs.length - 1] === cur ? want.s : project(net.path(refs[refs.length - 1]).points, waypoints[k]);
  }
  if (refs.length < 2) throw new Error('a route needs at least one junction');

  const edges = new Map<string, GraphEdge>(d.graph.edges.map(e => [e.id, e]));
  const endNode = (r: LaneRef) => {
    const e = edges.get(r.edgeId)!;
    return r.dir === 1 ? e.to : e.from;
  };
  const last = refs.length - 1;
  const steps: RouteStep[] = refs.map((ref, i) => ({
    ref,
    maneuver: i === 0 ? 'start' : i === last ? 'finish' : turnBetween(net, ref, refs[i + 1]),
    nodeId: i === last ? null : endNode(ref),
    waypointIndex: leadsTo[i],
  }));

  const startS = snaps[0].s, finishS = s;
  const startPath = net.path(refs[0]).points, finishPath = net.path(refs[last]).points;
  let lengthM = net.path(refs[0]).length - startS + finishS;
  for (let i = 1; i < refs.length; i++) {
    const c = net.connector(refs[i - 1], refs[i]);
    for (let j = 1; j < c.length; j++) lengthM += Math.hypot(c[j][0] - c[j - 1][0], c[j][1] - c[j - 1][1]);
    if (i < last) lengthM += net.path(refs[i]).length;
  }

  return {
    id, district, waypoints,
    start: pointAt(startPath, startS),
    finish: pointAt(finishPath, finishS),
    steps, lengthM,
    features: countFeatures(net, d, steps, startS, finishS),
  };
}

/** Counts what the route exercises; signs are left at zero for the sign layer to fill in. */
export function countFeatures(net: LaneNetwork, d: DistrictData, steps: RouteStep[], startS: number, finishS: number): RouteFeatures {
  const f: RouteFeatures = {
    signalledLeft: 0, signalledRight: 0, signalledStraight: 0, unsignalledPriorityRight: 0, zebras: 0,
    signalCrossings: 0, multiLaneTurns: 0, speedZones: 0, stopSigns: 0, giveWaySigns: 0,
  };
  const edges = new Map<string, GraphEdge>(d.graph.edges.map(e => [e.id, e]));
  const nodes = new Map(d.graph.nodes.map(n => [n.id, n]));
  const kinds = new Map(d.roads.map(r => [r.id, r.kind]));
  const rankOf = (edgeId: string) => rank(kinds.get(edges.get(edgeId)!.roadId) ?? '');

  const signalled = new Set<string>();
  for (const ctrl of d.controllers) {
    if (ctrl.id.startsWith(PED_CONTROLLER)) continue;
    for (const a of ctrl.phases.flat()) {
      if (!edges.has(a.edgeId)) continue;
      const ref: LaneRef = { edgeId: a.edgeId, dir: a.dir, lane: 0 };
      const len = net.path(ref).length;
      if (len - Math.min(len, Math.max(0, net.pathS(ref, a.stopAt))) <= SIGNAL_REACH) signalled.add(approachKey(a));
    }
  }

  for (let i = 0; i + 1 < steps.length; i++) {
    const from = steps[i].ref, to = steps[i + 1].ref;
    const e = edges.get(from.edgeId)!;
    const turn = turnBetween(net, from, to);
    if (signalled.has(approachKey(from))) {
      if (turn === 'left') f.signalledLeft++;
      else if (turn === 'right') f.signalledRight++;
      else if (turn === 'straight') f.signalledStraight++;
    } else if (turn !== 'uturn' && hasRoadFromRight(net, edges, nodes, from, to, rankOf)) {
      f.unsignalledPriorityRight++;
    }
    const lanes = from.dir === 1 ? e.lanesForward : e.lanesBackward;
    if ((turn === 'left' || turn === 'right') && lanes >= 2) f.multiLaneTurns++;
    if (e.maxspeed !== edges.get(to.edgeId)!.maxspeed) f.speedZones++;
  }

  const seen = new Set<string>();
  steps.forEach((step, i) => {
    const len = net.path(step.ref).length;
    const a = net.edgeS(step.ref, i === 0 ? startS : 0);
    const b = net.edgeS(step.ref, i === steps.length - 1 ? finishS : len);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (const c of d.crossings) {
      if (c.edgeId !== step.ref.edgeId || c.at < lo || c.at > hi || seen.has(c.id)) continue;
      seen.add(c.id);
      if (c.kind === 'zebra') f.zebras++;
      else if (c.kind === 'signal') f.signalCrossings++;
    }
  });
  return f;
}

/**
 * Whether an equivalent road other than the one being entered brings traffic into the junction from the driver's
 * right. Yard exits and roads of another class settle priority by rank, not by the right-hand rule.
 */
function hasRoadFromRight(
  net: LaneNetwork, edges: Map<string, GraphEdge>, nodes: Map<string, DistrictData['graph']['nodes'][number]>,
  from: LaneRef, to: LaneRef, rankOf: (edgeId: string) => number,
): boolean {
  const arrived = edges.get(from.edgeId)!;
  const node = nodes.get(from.dir === 1 ? arrived.to : arrived.from);
  if (!node || node.edges.length < 3) return false;
  const heading = endHeading(net.path(from).points);
  const own = rankOf(from.edgeId);
  if (own === 0) return false;
  return node.edges.some(id => {
    if (id === from.edgeId || id === to.edgeId || rankOf(id) !== own) return false;
    const e = edges.get(id)!;
    const atFrom = e.from === node.id;
    if ((atFrom ? e.lanesBackward : e.lanesForward) === 0) return false;
    const next = atFrom ? e.points[1] : e.points[e.points.length - 2];
    const bearing = Math.atan2(next[0] - node.position[0], next[1] - node.position[1]);
    return classifyTurn(heading, bearing) === 'right';
  });
}
