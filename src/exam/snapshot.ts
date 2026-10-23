import type { CrossingKind, DistrictData, Sign, Vec2 } from '../shared/district';
import type { GameEvent } from '../sim/events';
import type { LightState, SignalSystem } from '../sim/signals';
import type { SignSystem } from '../sim/signs';
import type { PedSim } from '../peds/pedSim';
import type { LaneNetwork, LaneRef } from '../traffic/lanes';
import { CAR_CLASSES, type TrafficSim } from '../traffic/trafficSim';
import { classifyTurn, endHeading, wrapAngle } from '../traffic/turns';
import type { CabinState } from '../vehicle/cabin';
import type { DrivetrainState, Gearbox } from '../vehicle/drivetrain';
import type { LaneMatch, MapMatcher } from './mapMatch';

export interface DriveSnapshot {
  t: number;
  dt: number;
  position: Vec2;
  heading: number;
  /** Signed along the heading, m/s. */
  speed: number;
  accel: number;
  gear: number;
  gearbox: Gearbox;
  running: boolean;
  cabin: CabinState;
  steer: number;
  match: LaneMatch;
  /** km/h, 0 when the car is not on a known road. */
  speedLimit: number;
  signalAhead: { state: LightState; distance: number; stopAt: number } | null;
  /** Distances are to the crossing centre along the matched edge, nearest first. */
  crossingsAhead: { id: string; distance: number; occupied: boolean; kind: CrossingKind; pedOnCarriageway: boolean; pedAtCurb: boolean }[];
  signsAhead: { sign: Sign; distance: number }[];
  /** Bumper-to-bumper gap and speed of the nearest car ahead in the player's lane. */
  leader: { distance: number; speed: number } | null;
  junctionConflicts: { agentId: number; fromRight: boolean; oncoming: boolean; tta: number }[];
  events: GameEvent[];
}

export interface SnapshotContext {
  d: DistrictData;
  net: LaneNetwork;
  matcher: Pick<MapMatcher, 'update'>;
  signals: SignalSystem;
  signs: SignSystem;
  peds: Pick<PedSim, 'occupied' | 'curbWaiting'>;
  traffic: Pick<TrafficSim, 'agents' | 'inspect'>;
  playerLength: number;
}

export interface SnapshotInput {
  t: number;
  dt: number;
  position: Vec2;
  heading: number;
  speed: number;
  prevSpeed: number;
  drivetrain: DrivetrainState;
  cabin: CabinState;
  steer: number;
  events: GameEvent[];
}

const LOOKAHEAD = 80;
const JUNCTION_REACH = 40;
/** Cars farther than this from the end of their lane are no conflict yet. */
const CONFLICT_RANGE = 60;
const LEADER_RANGE = 60;
const LEADER_HALF_WIDTH = 1.8;
const LEADER_ANGLE = Math.PI / 3;
const ONCOMING = (150 * Math.PI) / 180;
/** A crossing stays listed this far past its centre, while the car is still on it. */
const CROSSING_DEPTH = 2;
const REVERSING = -0.5;

interface Topology {
  crossingsByEdge: Map<string, DistrictData['crossings']>;
  endNode: (ref: LaneRef) => string;
  junctions: Set<string>;
}

const topologies = new WeakMap<DistrictData, Topology>();

function topology(d: DistrictData): Topology {
  let t = topologies.get(d);
  if (!t) {
    const edges = new Map(d.graph.edges.map(e => [e.id, e]));
    const crossingsByEdge = new Map<string, DistrictData['crossings']>();
    for (const c of d.crossings) crossingsByEdge.set(c.edgeId, [...(crossingsByEdge.get(c.edgeId) ?? []), c]);
    topologies.set(d, t = {
      crossingsByEdge,
      endNode: ref => {
        const e = edges.get(ref.edgeId)!;
        return ref.dir === 1 ? e.to : e.from;
      },
      junctions: new Set(d.graph.nodes.filter(n => n.edges.length >= 3).map(n => n.id)),
    });
  }
  return t;
}

/** One per fixed step. Pure apart from the matcher's hysteresis state. */
export function buildSnapshot(ctx: SnapshotContext, f: SnapshotInput): DriveSnapshot {
  const { d, net, signals, signs, peds } = ctx;
  const topo = topology(d);
  const travel = f.speed < REVERSING ? f.heading + Math.PI : f.heading;
  const match = ctx.matcher.update(f.position, travel, f.dt);
  const ref = match.ref;

  let speedLimit = 0;
  let signalAhead: DriveSnapshot['signalAhead'] = null;
  const crossingsAhead: DriveSnapshot['crossingsAhead'] = [];
  let signsAhead: DriveSnapshot['signsAhead'] = [];

  if (ref) {
    const { edgeId, dir } = ref;
    const s = match.edgeS;
    speedLimit = signs.speedLimitAt(edgeId, dir, s);
    signsAhead = signs.ahead(edgeId, dir, s, LOOKAHEAD).map(sign => ({ sign, distance: (sign.at - s) * dir }));
    for (const c of topo.crossingsByEdge.get(edgeId) ?? []) {
      const distance = (c.at - s) * dir;
      if (distance < -CROSSING_DEPTH || distance > LOOKAHEAD) continue;
      crossingsAhead.push({
        id: c.id, distance, kind: c.kind,
        occupied: peds.occupied(c.id), pedOnCarriageway: peds.occupied(c.id), pedAtCurb: peds.curbWaiting(c.id),
      });
    }
    crossingsAhead.sort((a, b) => a.distance - b.distance);
    if (!match.inJunction) {
      const lane = net.path(ref);
      const light = signals.approachState(edgeId, dir, s, [lane.startAt, lane.endAt]);
      if (light) {
        const distance = (light.stopAt - s) * dir;
        if (distance <= LOOKAHEAD) signalAhead = { state: light.state, distance: Math.max(0, distance), stopAt: light.stopAt };
      }
    }
  }

  return {
    t: f.t, dt: f.dt, position: f.position, heading: f.heading, speed: f.speed,
    accel: f.dt > 0 ? (f.speed - f.prevSpeed) / f.dt : 0,
    gear: f.drivetrain.gear, gearbox: f.drivetrain.gearbox, running: f.drivetrain.running,
    cabin: f.cabin, steer: f.steer, match, speedLimit, signalAhead, crossingsAhead, signsAhead,
    leader: leader(ctx, f),
    junctionConflicts: junctionConflicts(ctx, match, topo),
    events: f.events,
  };
}

function leader(ctx: SnapshotContext, f: SnapshotInput): DriveSnapshot['leader'] {
  const fx = Math.sin(f.heading), fz = Math.cos(f.heading);
  let best: DriveSnapshot['leader'] = null;
  for (const a of ctx.traffic.agents) {
    if (!a.active) continue;
    const dx = a.position[0] - f.position[0], dz = a.position[1] - f.position[1];
    const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
    if (along <= 0 || along > LEADER_RANGE || Math.abs(across) > LEADER_HALF_WIDTH) continue;
    if (Math.abs(wrapAngle(a.heading - f.heading)) > LEADER_ANGLE) continue;
    const gap = Math.max(0, along - ctx.playerLength / 2 - CAR_CLASSES[a.carClass].length / 2);
    if (!best || gap < best.distance) best = { distance: gap, speed: a.speed };
  }
  return best;
}

const approachKey = (r: LaneRef) => `${r.edgeId}|${r.dir}`;

function junctionConflicts(ctx: SnapshotContext, match: LaneMatch, topo: Topology): DriveSnapshot['junctionConflicts'] {
  const ref = match.ref;
  if (!ref) return [];
  const { net } = ctx;
  let node = match.inJunction;
  if (!node) {
    const toEnd = net.path(ref).length - net.pathS(ref, match.edgeS);
    const end = topo.endNode(ref);
    if (toEnd > JUNCTION_REACH || !topo.junctions.has(end)) return [];
    node = end;
  }
  const mine = approachKey(ref);
  const ph = endHeading(net.path(ref).points);
  const out: DriveSnapshot['junctionConflicts'] = [];
  for (const v of ctx.traffic.agents) {
    if (!v.active) continue;
    const a = ctx.traffic.inspect(v.id);
    if (!a || approachKey(a.ref) === mine) continue;
    const path = net.path(a.ref);
    let tta: number;
    if (a.connectorNode === node) tta = 0;
    else if (a.connectorNode === null && topo.endNode(a.ref) === node) {
      const toEnd = path.length - a.s;
      if (toEnd > CONFLICT_RANGE) continue;
      tta = toEnd / Math.max(v.speed, 0.1);
    } else continue;
    const ah = endHeading(path.points);
    out.push({
      agentId: v.id,
      fromRight: classifyTurn(ph, ah) === 'left',
      oncoming: Math.abs(wrapAngle(ah - ph)) > ONCOMING,
      tta,
    });
  }
  return out.sort((x, y) => x.tta - y.tta || x.agentId - y.agentId);
}
