import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { DistrictData, GraphEdge, Sign } from '../../src/shared/district';
import { turnBetween, type ExamRoute, type Maneuver } from '../../src/exam/route';
import { entry } from '../../src/shared/signCatalogue';
import { NO_ENTRY_REACH } from '../../src/exam/rules/thresholds';
import { JUNCTION_REACH } from '../../src/sim/signs';
import { LaneNetwork } from '../../src/traffic/lanes';
import { project } from '../../src/traffic/turns';
import { signSpots } from '../../src/world/signMount';

export interface FreeSpot {
  edgeId: string;
  dir: 1 | -1;
  side: 'right' | 'left';
  at: number;
  routeIds: string[];
  /** Metres to the edge end in the travel direction. */
  beforeJunction: number;
}

type Turn = Exclude<Maneuver, 'start' | 'finish'>;

const GENTRA = { mass: 1.3, height: 1.45, width: 1.74, length: 4.48 };
/** The heavier axle carries at least half the mass, so a lower axle limit binds the Gentra for certain. */
const GENTRA_AXLE = GENTRA.mass / 2;

/** Signs that close the lane they stand on to the Gentra, or that the route would have to stop at. */
const LANE_BANS = new Set(['3.1', '3.2', '3.3', '3.17.1', '3.17.2', '3.17.3', '3.35', '4.5', '4.6']);
/** Paths closed to cars; their catalogue entries are not car-relevant, but a car must not drive past them. */
const PATH_BANS = new Set(['4.6.1', '4.6.2', '4.6.3', '4.6.4', '4.6.5', '4.6.6']);
const RIGHT_ON_RED = '5.42';
const BOUND_BY: Record<string, number> = { '3.11': GENTRA.mass, '3.12': GENTRA_AXLE, '3.13': GENTRA.height, '3.14': GENTRA.width, '3.15': GENTRA.length };
const TURN_BANS: Record<string, Turn> = { '3.18.1': 'right', '3.18.2': 'left', '3.19': 'uturn' };
/** 4.1.5 and 4.1.6 allow a U-turn too: the 4.1.3 meaning says left-turn signs also permit one. */
const ALLOWED: Record<string, Turn[]> = {
  '4.1.1': ['straight'],
  '4.1.2': ['right'],
  '4.1.3': ['left', 'uturn'],
  '4.1.4': ['straight', 'right'],
  '4.1.5': ['straight', 'left', 'uturn'],
  '4.1.6': ['left', 'right', 'uturn'],
  // The graph has no roundabouts; following the counter-clockwise arrows from an approach is a right turn onto the ring.
  '4.3': ['right'],
};
const MIN_SPEED_LIMIT = 20;
const MAX_MIN_SPEED = 40;

const polyLength = (pts: GraphEdge['points']) => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
};
const round = (v: number) => Math.round(v * 1000) / 1000;
/** Metres into the edge in the travel direction. */
const travelled = (len: number, dir: 1 | -1, at: number) => (dir === 1 ? at : len - at);
/** Right-hand kerb of the travel direction is +1; the left pole of one direction stands on the other's right kerb. */
const kerb = (edgeId: string, dir: 1 | -1, side: 'right' | 'left') => `${edgeId}|${dir * (side === 'left' ? -1 : 1)}`;

interface Span { route: ExamRoute; step: number; edge: GraphEdge; dir: 1 | -1; len: number; from: number; to: number }

/** What each step of each route drives, in metres into its edge in the travel direction. */
function spans(d: DistrictData, routes: ExamRoute[]): Span[] {
  const edges = new Map(d.graph.edges.map(e => [e.id, e]));
  const out: Span[] = [];
  for (const route of routes) {
    const last = route.steps.length - 1;
    route.steps.forEach((step, i) => {
      const edge = edges.get(step.ref.edgeId);
      if (!edge) throw new Error(`${route.id} drives missing edge ${step.ref.edgeId}`);
      const len = polyLength(edge.points);
      const at = (p: ExamRoute['start']) => travelled(len, step.ref.dir, project(edge.points, p.position));
      out.push({ route, step: i, edge, dir: step.ref.dir, len, from: i === 0 ? at(route.start) : 0, to: i === last ? at(route.finish) : len });
    });
  }
  return out;
}

export function freeSpots(d: DistrictData, routes: ExamRoute[], spacing = 15): FreeSpot[] {
  const poles = new Map<string, number[]>();
  for (const p of signSpots(d.signs)) {
    const k = kerb(p.edgeId, p.dir, p.side);
    poles.set(k, [...(poles.get(k) ?? []), p.at]);
  }
  const net = new LaneNetwork(d);
  const spots = new Map<string, FreeSpot>();
  for (const { route, step, edge, dir, len, from, to } of spans(d, routes)) {
    // Inside the junction mouth a pole would stand in the crossing road.
    const path = net.path(route.steps[step].ref);
    const lo = Math.max(from, travelled(len, dir, path.startAt)), hi = Math.min(to, travelled(len, dir, path.endAt));
    const sides: ('right' | 'left')[] = (dir === 1 ? edge.lanesForward : edge.lanesBackward) >= 2 ? ['right', 'left'] : ['right'];
    for (let t = spacing; t < len; t += spacing) {
      if (t < lo || t > hi) continue;
      const at = round(dir === 1 ? t : len - t);
      for (const side of sides) {
        if ((poles.get(kerb(edge.id, dir, side)) ?? []).some(p => Math.abs(p - at) < spacing)) continue;
        const key = `${edge.id}|${dir}|${side}|${at}`;
        const spot = spots.get(key);
        if (!spot) spots.set(key, { edgeId: edge.id, dir, side, at, routeIds: [route.id], beforeJunction: round(len - t) });
        else if (!spot.routeIds.includes(route.id)) spot.routeIds.push(route.id);
      }
    }
  }
  return [...spots.values()];
}

export function routeConflicts(sign: Sign, routes: ExamRoute[], net: LaneNetwork, d: DistrictData): string[] {
  const e = entry(sign.code);
  if (!e.carRelevant && !PATH_BANS.has(sign.code)) return [];
  const where = `${sign.code} (${e.name.en}) on ${sign.edgeId} dir ${sign.dir} at ${sign.at} m`;
  const value = typeof sign.value === 'number' ? sign.value : undefined;
  const out = new Set<string>();
  if (sign.origin === 'coverage' && value !== undefined) {
    if (sign.code === '3.24' && value < MIN_SPEED_LIMIT) out.add(`${where}: a ${value} km/h limit is below ${MIN_SPEED_LIMIT}`);
    if (sign.code === '4.7' && value > MAX_MIN_SPEED) out.add(`${where}: a ${value} km/h minimum is above ${MAX_MIN_SPEED}`);
  }
  const bound = LANE_BANS.has(sign.code) || PATH_BANS.has(sign.code) || (sign.code in BOUND_BY && value !== undefined && value < BOUND_BY[sign.code]);
  // The examiner has no right-on-red exception, so obeying 5.42 there would be a red-light fail.
  const signalled = sign.code === RIGHT_ON_RED && d.controllers.some(c => c.phases.some(p => p.some(a => a.edgeId === sign.edgeId && a.dir === sign.dir)));
  const banned = TURN_BANS[sign.code], allowed = ALLOWED[sign.code];
  for (const { route, step, edge, dir, len, from, to } of spans(d, routes)) {
    if (edge.id !== sign.edgeId || dir !== sign.dir) continue;
    const ref = route.steps[step].ref;
    const t = travelled(len, dir, sign.at);
    // The examiner faults entering past a no-entry this close to the edge's entry, however far the car then goes.
    if (sign.code === '3.1' && step > 0 && t <= NO_ENTRY_REACH) out.add(`${where}: ${route.id} enters this lane past it`);
    else if (bound && t >= from && t <= to) out.add(`${where}: ${route.id} drives this lane and the Gentra is bound by it`);
    if (signalled && t >= from && t <= to) out.add(`${where}: ${route.id} drives this signalled approach and the examiner has no right turn on red`);
    if ((!banned && !allowed) || step === route.steps.length - 1 || len - t > JUNCTION_REACH) continue;
    const turn = turnBetween(net, ref, route.steps[step + 1].ref);
    const node = route.steps[step].nodeId;
    if (banned === turn) out.add(`${where}: ${route.id} turns ${turn} at ${node}`);
    if (allowed && !allowed.includes(turn)) out.add(`${where}: ${route.id} goes ${turn} at ${node}, the sign allows only ${allowed.join(', ')}`);
  }
  return [...out];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const district = process.argv[2];
  if (!district) throw new Error('usage: npm run signs:spots -- <district>');
  const d: DistrictData = JSON.parse(readFileSync(`public/districts/${district}/district.json`, 'utf8'));
  const { routes: ids } = JSON.parse(readFileSync(`data/districts/${district}/routes/index.json`, 'utf8')) as { routes: string[] };
  const routes: ExamRoute[] = ids.map(id => JSON.parse(readFileSync(`public/districts/${district}/routes/${id}.json`, 'utf8')));
  const net = new LaneNetwork(d);
  const spots = freeSpots(d, routes);
  for (const route of routes) {
    const own = spots.filter(s => s.routeIds.includes(route.id));
    console.info(`${route.id}: ${own.length} free spots`);
    for (const s of own) console.info(`  ${s.edgeId} dir ${s.dir} ${s.side} at ${s.at} m, ${s.beforeJunction} m before the junction${s.routeIds.length > 1 ? ` (also ${s.routeIds.filter(r => r !== route.id).join(', ')})` : ''}`);
  }
  for (const origin of ['coverage', 'hand', 'rule'] as const) {
    const signs = d.signs.filter(s => s.origin === origin);
    const bad = signs.map(s => [s, routeConflicts(s, routes, net, d)] as const).filter(([, r]) => r.length);
    console.info(`${origin} signs: ${signs.length}, ${bad.length} in conflict with a route`);
    for (const [s, reasons] of origin === 'coverage' ? signs.map(s => [s, routeConflicts(s, routes, net, d)] as const) : bad) {
      console.info(`  ${s.id}: ${reasons.length ? '' : 'ok'}`);
      for (const r of reasons) console.info(`    ${r}`);
    }
  }
}
