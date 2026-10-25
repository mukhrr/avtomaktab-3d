import type { Crossing, DistrictData, GraphEdge, Vec2 } from '../shared/district';
import { rng } from '../sim/rng';
import type { SignalSystem } from '../sim/signals';
import { SignSystem } from '../sim/signs';
import { nearestLane } from '../world/spawn';
import { DEFAULT_DRIVER, idmAccel, turnSpeed } from './idm';
import {
  blend, blendRate, CHANGE_TIME, CLEAR_OF_END, CONSIDER_EVERY, HARD_BRAKE, LANE_CHANGE_SEED, MIN_CHANGE_SPEED, mobil, mobilSafe,
  PLAYER_HEADWAY, SAFE_BRAKE, SIGNAL_TIME, TURN_BIAS, type FollowerAccel, type LaneChange, type MobilInput,
} from './laneChange';
import { pointAt, type LaneNetwork, type LaneRef } from './lanes';
import { CAR_CLASSES, pickClass, pickPaint, type CarClass } from './carClasses';
import { approachKey, laneKey, nearestObstacle, type LookaheadWorld, type Obstacle } from './lookahead';
import { classifyTurn, endHeading, project, turnBetween, wrapAngle, type Turn } from './turns';

/** Junction priority of an approach from its signs: priorityRoad 2, unsigned 1, stop or giveWay 0. */
export function approachRank(signs: readonly { type: string }[]): number {
  const types = new Set(signs.map(g => g.type));
  return types.has('stop') || types.has('giveWay') ? 0 : types.has('priorityRoad') ? 2 : 1;
}

export interface PlayerState {
  position: Vec2;
  heading: number;
  /** Signed speed along `heading`, m/s. */
  speed: number;
  length: number;
  width: number;
}

export { CAR_CLASSES, type CarClass } from './carClasses';

export interface AgentView {
  id: number;
  active: boolean;
  position: Vec2;
  heading: number;
  carClass: CarClass;
  colour: number;
  braking: boolean;
  speed: number;
  indicator: 'left' | 'right' | null;
}

export interface CrossingOccupancy {
  occupied(crossingId: string): boolean;
}

export interface Conn {
  key: string;
  from: LaneRef;
  to: LaneRef;
  points: Vec2[];
  length: number;
  /** Node the connector crosses. */
  node: string;
  turn: number;
  kind: Turn;
}

export interface Agent extends AgentView {
  /** Current lane, or the lane being left while on a connector. */
  ref: LaneRef;
  s: number;
  conn: Conn | null;
  next: LaneRef | null;
  nextConn: Conn | null;
  route: LaneRef[];
  trapped: boolean;
  factor: number;
  length: number;
  generation: number;
  /** Seconds since the agent last moved. */
  still: number;
  /** Seconds at a full stop near the end of a lane with a stop sign, and whether that stop is done. */
  rest: number;
  stopDone: boolean;
  changing: LaneChange | null;
  /** Sim time of the next lane-change consideration. */
  considerAt: number;
  /** The player was the nearest obstacle on the last step. */
  heldByPlayer: boolean;
}

/** A car on a lane, or one changing into or out of it, at its path distance along that lane. */
interface Occupant {
  a: Agent;
  s: number;
}

interface ApproachInfo {
  node: string;
  /** priorityRoad 2, unsigned 1, stop or giveWay 0. */
  rank: number;
  /** Travel heading where the approach meets the junction. */
  heading: number;
}

/** An approach with a car about to reach a gated junction, or holding there. */
interface Contender {
  info: ApproachInfo;
  since: number;
  permitted: boolean;
}

interface Reservation {
  approach: string;
  holders: Set<number>;
  since: number;
  /** Last time a car joined or a holder was moving through the junction. */
  lastActive: number;
}

const CHOOSE_AT = 40;
const TURN_ZONE = 25;
const TURN_DECEL = 3;
const RESERVATION_TTL = 6;
const PLATOON_WINDOW = 3;
const YIELD_TIME = 4;
const WAIT_FRESH = 0.5;
/** Time to arrival inside which a car (or the player) claims its priority at a junction. */
const PRIORITY_TTA = 3;
const STARVED = 8;
const FULL_STOP = 0.3;
const STOP_HOLD = 0.5;
const STOP_ZONE = 6;
const PLAYER_SNAP = 8;
const MOVING = 0.5;
const SIGNAL_REACH = 40;
const PED_CONTROLLER = 'ped-';
const SPAWN_SPACING = 2 * 4.5;
const SPAWN_MAX = 300;
const SPAWN_MIN = 120;
const INITIAL_SPAWN_MIN = 30;
const DESPAWN_AT = 350;
const GRIDLOCK_TIME = 60;
/** A stuck car still after this while in the player's sight is cleared too. */
const GRIDLOCK_SEEN_TIME = 120;
const GRIDLOCK_LAST_RESORT = 240;
/** A stuck car closer than this within AHEAD_HALF_ANGLE in front of the player is never made to vanish. */
const JAM_KEEP_RANGE = 15;
const AHEAD_HALF_ANGLE = Math.PI / 3;
/** Beside counts as in sight; only what lies behind this is out of it. */
const SIGHT_HALF_ANGLE = (110 * Math.PI) / 180;
/** "About to touch": this close to the player's box. */
const CONTACT_MARGIN = 1;
const SPAWN_ATTEMPTS = 30;
const BRAKING = -1;
const DEFAULT_KMH = 60;

const polyLength = (pts: Vec2[]) => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
};

/** The boxes, the player's grown by CONTACT_MARGIN, overlap. */
function touching(a: Agent, player: PlayerState): boolean {
  const dx = a.position[0] - player.position[0], dz = a.position[1] - player.position[1];
  const ext = (h: number, l: number, w: number, ax: number, az: number) =>
    (l / 2) * Math.abs(Math.sin(h) * ax + Math.cos(h) * az) + (w / 2) * Math.abs(Math.cos(h) * ax - Math.sin(h) * az);
  const width = CAR_CLASSES[a.carClass].width;
  const pl = player.length + 2 * CONTACT_MARGIN, pw = player.width + 2 * CONTACT_MARGIN;
  return [a.heading, a.heading + Math.PI / 2, player.heading, player.heading + Math.PI / 2].every(h => {
    const ax = Math.sin(h), az = Math.cos(h);
    return Math.abs(dx * ax + dz * az) <= ext(a.heading, a.length, width, ax, az) + ext(player.heading, pl, pw, ax, az);
  });
}

export class TrafficSim {
  private readonly pool: Agent[] = [];
  readonly agents: readonly AgentView[] = this.pool;
  private readonly rand: () => number;
  private readonly laneRand: () => number;
  private changes = 0;
  private readonly count: number;
  private readonly edges = new Map<string, GraphEdge>();
  private readonly crossingsByEdge = new Map<string, Crossing[]>();
  private readonly gated = new Set<string>();
  private readonly spawnLanes: { ref: LaneRef; cum: number }[] = [];
  private readonly spawnTotal: number;
  private readonly conns = new Map<string, Conn>();
  private readonly byPiece = new Map<string, Agent[]>();
  private readonly byLeaving = new Map<string, Agent[]>();
  /** Rebuilt each step: changing cars by the lane (laneKey) they are crossing to or from but not indexed on. */
  private readonly beside = new Map<string, Agent[]>();
  /** Rebuilt each step: cars on connectors by the lane (laneKey) they lead into. */
  private readonly arriving = new Map<string, Agent[]>();
  private readonly reservations = new Map<string, Reservation>();
  /** Agents on a connector of each gated node, and on gated-node connectors into each lane (laneKey). */
  private readonly onNode = new Map<string, Set<Agent>>();
  private readonly entering = new Map<string, Set<Agent>>();
  private readonly deadEnds = new Set<string>();
  private readonly yields = new Map<string, { approach: string; until: number }>();
  /** Per gated node, approaches whose lead car is held at it, with the time it was last seen waiting. */
  private readonly waiting = new Map<string, Map<string, number>>();
  /** Per gated node, approaches contending for it and since when; cleared for an approach when it takes the node. */
  private readonly arrivals = new Map<string, Map<string, number>>();
  private readonly approaches = new Map<string, ApproachInfo>();
  private readonly oncoming = new Map<string, string[]>();
  private readonly stopSigns = new Set<string>();
  /** Rebuilt each step: who is about to arrive at each gated node, and an approach let go out of turn. */
  private readonly contenders = new Map<string, Map<string, Contender>>();
  private readonly playerAt = new Map<string, ApproachInfo & { key: string }>();
  private readonly goesNext = new Map<string, string>();
  /** Rebuilt each step: approaches into ungated junctions with a straight-bound car (or the player) about to cross. */
  private readonly threats = new Set<string>();
  private readonly world: LookaheadWorld;
  private time = 0;
  private started = false;

  constructor(
    private readonly d: DistrictData, private readonly net: LaneNetwork, signals: SignalSystem,
    opts: { count: number; seed: number }, private readonly signs = new SignSystem(d),
  ) {
    this.rand = rng(opts.seed);
    this.laneRand = rng(opts.seed + LANE_CHANGE_SEED);
    this.count = opts.count;
    for (const e of d.graph.edges) this.edges.set(e.id, e);
    for (const c of d.crossings) {
      const list = this.crossingsByEdge.get(c.edgeId) ?? [];
      list.push(c);
      this.crossingsByEdge.set(c.edgeId, list);
    }
    // Approach -> vehicle controllers with a stop line on it near the junction it arrives at.
    const stopsNear = new Map<string, Set<string>>();
    for (const ctrl of d.controllers) {
      // Standalone pedestrian lights run unrelated offsets, so together they never keep two arms apart.
      if (ctrl.id.startsWith(PED_CONTROLLER)) continue;
      for (const a of ctrl.phases.flat()) {
        if (!this.edges.has(a.edgeId)) continue;
        const ref: LaneRef = { edgeId: a.edgeId, dir: a.dir, lane: 0 };
        const len = net.path(ref).length;
        if (len - Math.min(len, Math.max(0, net.pathS(ref, a.stopAt))) > SIGNAL_REACH) continue;
        const k = approachKey(ref);
        const set = stopsNear.get(k) ?? new Set<string>();
        set.add(ctrl.id);
        stopsNear.set(k, set);
      }
    }
    const nodeEdges = new Map<string, number>();
    for (const n of d.graph.nodes) {
      nodeEdges.set(n.id, n.edges.length);
      if (n.edges.length === 1) this.deadEnds.add(n.id);
      if (n.edges.length < 3) continue;
      // A junction is left to the lights only when one controller stops every arm arriving at it close by.
      const arms = n.edges.flatMap(id => {
        const e = this.edge(id);
        return ([[1, e.lanesForward, e.to], [-1, e.lanesBackward, e.from]] as const)
          .filter(([, lanes, end]) => lanes > 0 && end === n.id)
          .map(([dir]) => stopsNear.get(`${id}|${dir}`) ?? new Set<string>());
      });
      if (arms.length && ![...arms[0]].some(c => arms.every(set => set.has(c)))) this.gated.add(n.id);
    }
    for (const e of d.graph.edges) {
      for (const [dir, lanes, end] of [[1, e.lanesForward, e.to], [-1, e.lanesBackward, e.from]] as const) {
        if (lanes === 0) continue;
        const ref: LaneRef = { edgeId: e.id, dir, lane: 0 };
        const at = signs.atJunction(ref);
        if (at.some(g => g.type === 'stop')) this.stopSigns.add(approachKey(ref));
        if ((nodeEdges.get(end) ?? 0) < 3) continue;
        const rank = approachRank(at);
        this.approaches.set(approachKey(ref), { node: end, rank, heading: endHeading(net.path(ref).points) });
      }
    }
    for (const [k, a] of this.approaches) {
      const opposite = [...this.approaches].filter(([, b]) => b.node === a.node && classifyTurn(a.heading, b.heading) === 'uturn');
      if (opposite.length) this.oncoming.set(k, opposite.map(([j]) => j));
    }

    let cum = 0;
    for (const e of d.graph.edges) {
      for (const [dir, lanes] of [[1, e.lanesForward], [-1, e.lanesBackward]] as const) {
        for (let lane = 0; lane < lanes; lane++) {
          const ref: LaneRef = { edgeId: e.id, dir, lane };
          cum += net.path(ref).length;
          this.spawnLanes.push({ ref, cum });
        }
      }
    }
    this.spawnTotal = cum;

    this.world = {
      net, signals,
      laneWidth: id => {
        const e = this.edge(id);
        return e.width / Math.max(1, e.lanesForward + e.lanesBackward);
      },
      crossingsOn: id => this.crossingsByEdge.get(id) ?? [],
      onPiece: k => this.byPiece.get(k),
      leaving: k => this.byLeaving.get(k),
      gatedNode: ref => this.gatedNode(ref),
      canEnter: (node, ref, next, length, committed) =>
        this.canEnter(node, approachKey(ref), !committed && net.path(ref).length >= length) && (!next || this.hasRoom(next, length)),
      mustHold: (a, ref, committed) => this.mustHold(a, ref, committed),
    };
  }

  step(dt: number, player: PlayerState, crossings: CrossingOccupancy): void {
    this.time += dt;
    for (const [node, r] of this.reservations) {
      if (this.time - r.lastActive <= RESERVATION_TTL) continue;
      // Holders still on the junction keep it however long they stand there; only orphaned reservations expire.
      if ([...r.holders].some(id => this.pool[id]?.active && this.pool[id].conn?.node === node)) continue;
      this.reservations.delete(node);
      this.yields.set(node, { approach: r.approach, until: this.time + YIELD_TIME });
    }
    for (const a of this.pool) {
      if (!a.active) continue;
      const d = dist(a.position, player.position);
      if (d > DESPAWN_AT || (a.still > GRIDLOCK_TIME && this.jamCleared(a, d, player))) this.despawn(a);
    }
    this.buildIndex();
    this.arbitrate(player);
    for (const a of this.pool) if (a.active) this.advance(a, dt, player, crossings);
    this.fill(player, this.started ? SPAWN_MIN : INITIAL_SPAWN_MIN);
    this.started = true;
  }

  /**
   * Exclusive junctions can lock in a ring of short edges. A stuck car out of the player's sight goes first; one in
   * sight only after the longer wait, once clearing the unseen ones has not freed it; one close in front of the
   * player last of all, when the player is part of the ring. A car touching the player is never made to vanish.
   */
  private jamCleared(a: Agent, d: number, player: PlayerState): boolean {
    if (touching(a, player)) return false;
    const off = Math.abs(wrapAngle(Math.atan2(a.position[0] - player.position[0], a.position[1] - player.position[1]) - player.heading));
    if (off > SIGHT_HALF_ANGLE) return true;
    if (d <= JAM_KEEP_RANGE && off <= AHEAD_HALF_ANGLE) return a.still > GRIDLOCK_LAST_RESORT;
    return a.still > GRIDLOCK_SEEN_TIME;
  }

  /** Removes every car within `radius` of `position`, for placing the player there. */
  clearNear(position: Vec2, radius: number): void {
    for (const a of this.pool) if (a.active && dist(a.position, position) < radius) this.despawn(a);
  }

  /** Lane changes started since the sim was made. */
  get laneChanges(): number {
    return this.changes;
  }

  reservationHolder(nodeId: string): number | null {
    const r = this.reservations.get(nodeId);
    if (!r) return null;
    for (const id of r.holders) return id;
    return null;
  }

  /** Puts an agent at path distance `s` on `ref`; `route` overrides the random choice at the next junctions. */
  place(ref: LaneRef, s: number, opts: { speed?: number; carClass?: CarClass; route?: LaneRef[]; factor?: number } = {}): number {
    const a = this.create(ref, s, opts.carClass ?? pickClass(this.rand()), opts.speed);
    a.route = [...(opts.route ?? [])];
    if (opts.factor !== undefined) a.factor = opts.factor;
    return a.id;
  }

  /** `turn` is the connector being driven, else the one chosen for the next junction, null before choosing. */
  inspect(id: number): {
    ref: LaneRef; s: number; connectorNode: string | null; generation: number; turn: Turn | null;
    changing: { from: LaneRef; to: LaneRef; t: number; back: boolean } | null;
    heldByPlayer: boolean;
  } | null {
    const a = this.pool[id];
    if (!a || !a.active) return null;
    const ch = a.changing;
    return {
      ref: a.ref, s: a.s, connectorNode: a.conn?.node ?? null, generation: a.generation, turn: (a.conn ?? a.nextConn)?.kind ?? null,
      changing: ch ? { from: ch.from, to: ch.to, t: ch.t, back: ch.back } : null, heldByPlayer: a.heldByPlayer,
    };
  }

  private advance(a: Agent, dt: number, player: PlayerState, crossings: CrossingOccupancy): void {
    // A choice made on a lane the car is about to leave would be for the wrong lane; moveAlong still chooses at the end.
    if (!a.conn && !a.next && !a.trapped && !a.changing && this.net.path(a.ref).length - a.s <= CHOOSE_AT) this.chooseNext(a);
    const v0 = Math.max(1, this.desiredSpeed(a));
    let ob = nearestObstacle(a, this.world, player, crossings);
    ob = nearer(ob, this.mergerAhead(a));
    if (!a.conn) {
      if (a.changing && a.changing.t >= 0) ob = nearer(ob, nearestObstacle(this.ghost(a, this.otherLane(a)), this.world, player, crossings));
    }
    if (a.conn && a.speed > MOVING) {
      const r = this.reservations.get(a.conn.node);
      if (r?.holders.has(a.id)) r.lastActive = this.time;
    }
    if (ob?.gate) {
      const node = ob.gate;
      const m = this.waiting.get(node) ?? new Map<string, number>();
      m.set(approachKey(a.conn ? a.conn.to : a.ref), this.time);
      this.waiting.set(node, m);
    }
    a.heldByPlayer = !!ob?.player;
    const acc = idmAccel(a.speed, ob ? ob.gap : null, ob ? ob.speed : 0, { v0, ...DEFAULT_DRIVER });
    a.speed = Math.max(0, a.speed + acc * dt);
    a.braking = acc < BRAKING;
    a.still = a.speed < MOVING ? a.still + dt : 0;
    if (!a.conn && !a.stopDone && this.stopSigns.has(approachKey(a.ref))) {
      const toEnd = this.net.path(a.ref).length - a.s - a.length / 2;
      a.rest = a.speed < FULL_STOP && toEnd < STOP_ZONE ? a.rest + dt : 0;
      if (a.rest >= STOP_HOLD) a.stopDone = true;
    }
    a.s += a.speed * dt;
    if (a.changing) this.stepChange(a, dt, acc, player, crossings);
    else if (!a.conn && this.time >= a.considerAt) {
      a.considerAt = this.time + CONSIDER_EVERY * (1 + this.laneRand());
      this.considerChange(a, acc, player, crossings);
    }
    if (!this.moveAlong(a)) return;
    const p = pointAt(a.conn ? a.conn.points : this.net.path(a.ref).points, a.s);
    a.position = p.position;
    a.heading = p.heading;
    const ch = a.changing;
    if (ch && ch.t > 0 && !a.conn) {
      const other = this.otherLane(a);
      const q = pointAt(this.net.path(other).points, this.mapS(a.ref, a.s, other));
      const w = blend(ch.t, ch.dur);
      // Weight of the lane the car is indexed on: the old lane until halfway, the new one after.
      const own = a.ref === ch.from ? 1 - w : w;
      a.position = [p.position[0] * own + q.position[0] * (1 - own), p.position[1] * own + q.position[1] * (1 - own)];
      const side = (ch.to.lane > ch.from.lane ? 1 : -1) * (ch.back ? -1 : 1);
      a.heading = p.heading + side * Math.atan2(this.world.laneWidth(ch.from.edgeId) * blendRate(ch.t, ch.dur), Math.max(a.speed, 1));
    }
  }

  private considerChange(a: Agent, acc: number, player: PlayerState, crossings: CrossingOccupancy): void {
    if (a.next || a.trapped || acc < HARD_BRAKE || a.speed < MIN_CHANGE_SPEED || a.s < CLEAR_OF_END) return;
    const lanes = this.laneCount(a.ref);
    if (lanes < 2 || !this.clearAhead(a.ref, a.s, a.speed * (SIGNAL_TIME + CHANGE_TIME))) return;
    for (const lane of [a.ref.lane + 1, a.ref.lane - 1]) {
      if (lane < 0 || lane >= lanes) continue;
      const to: LaneRef = { ...a.ref, lane };
      const input = this.assess(a, to, acc, player, crossings);
      if (!input || !mobil(input)) continue;
      a.changing = { from: a.ref, to, t: -SIGNAL_TIME, dur: CHANGE_TIME, back: false };
      // Lane 0 is rightmost, so a higher lane is to the left.
      a.indicator = lane > a.ref.lane ? 'left' : 'right';
      return;
    }
  }

  private stepChange(a: Agent, dt: number, acc: number, player: PlayerState, crossings: CrossingOccupancy): void {
    const ch = a.changing!;
    const before = ch.t;
    // Across the lanes the car moves with its forward speed, so one standing in a queue does not slide sideways.
    const rate = before < 0 ? 1 : Math.min(1, a.speed / MIN_CHANGE_SPEED);
    if (ch.back) {
      ch.t -= dt * rate;
      if (ch.t <= 0) {
        a.changing = null;
        a.indicator = null;
      }
      return;
    }
    ch.t += dt * rate;
    if (before >= 0 && a.ref === ch.from) {
      const input = this.assess(a, ch.to, acc, player, crossings);
      if (!input || !mobilSafe(input)) {
        ch.back = true;
        return;
      }
    }
    if (before < 0 && ch.t >= 0) {
      // The gap is judged again as the car starts across: the player or another car may have moved into it.
      const input = acc < HARD_BRAKE || a.next || a.s < CLEAR_OF_END || !this.clearAhead(a.ref, a.s, a.speed * CHANGE_TIME)
        ? null : this.assess(a, ch.to, acc, player, crossings);
      if (!input || !mobilSafe(input)) {
        a.changing = null;
        a.indicator = null;
        return;
      }
      this.changes++;
    }
    if (ch.t >= ch.dur / 2 && a.ref === ch.from) this.swapLane(a);
    if (ch.t >= ch.dur) this.endChange(a);
  }

  private swapLane(a: Agent): void {
    const ch = a.changing!;
    a.s = this.mapS(ch.from, a.s, ch.to);
    a.ref = ch.to;
  }

  /** Ends the change where it stands: a car signalling or returning stays in its lane, one moving across lands in the new one. */
  private endChange(a: Agent): void {
    const ch = a.changing;
    if (ch && ch.t >= 0 && !ch.back && a.ref === ch.from) this.swapLane(a);
    a.changing = null;
    a.indicator = null;
  }

  /**
   * MOBIL inputs for moving to `to`, or null when the player is in that lane within PLAYER_HEADWAY of the gap, or
   * would have to brake harder than SAFE_BRAKE for it.
   */
  private assess(a: Agent, to: LaneRef, acc: number, player: PlayerState, crossings: CrossingOccupancy): MobilInput | null {
    const s = this.mapS(a.ref, a.s, to);
    if (!this.playerClear(a, to, s, player)) return null;
    const ob = nearer(nearestObstacle(this.ghost(a, to, s), this.world, player, crossings), this.mergerAhead(this.ghost(a, to, s)));
    const aNew = idmAccel(a.speed, ob ? ob.gap : null, ob ? ob.speed : 0, { v0: Math.max(1, this.desiredSpeed(a)), ...DEFAULT_DRIVER });
    const target = this.occupants(to, a);
    const behind = target.filter(o => o.s < s).pop();
    const ahead = target.find(o => o.s >= s);
    let followerNew: FollowerAccel | null = null;
    if (behind) {
      const f = behind.a;
      followerNew = {
        a: this.follow(f, ahead ? ahead.s - behind.s - (f.length + ahead.a.length) / 2 : null, ahead?.a.speed ?? 0),
        aNew: this.follow(f, s - behind.s - (f.length + a.length) / 2, a.speed),
      };
    }
    const mine = this.occupants(a.ref, a);
    // Keep right: a car moves left only for its own gain, never to make way for the one behind.
    const fo = to.lane > a.ref.lane ? undefined : mine.filter(o => o.s < a.s).pop();
    const lead = mine.find(o => o.s >= a.s);
    let followerOld: FollowerAccel | null = null;
    if (fo) {
      const f = fo.a;
      followerOld = {
        a: this.follow(f, a.s - fo.s - (f.length + a.length) / 2, a.speed),
        aNew: this.follow(f, lead ? lead.s - fo.s - (f.length + lead.a.length) / 2 : null, lead?.a.speed ?? 0),
      };
    }
    return { a: acc, aNew, followerOld, followerNew, bias: this.turnBias(a, to) };
  }

  private follow(f: Agent, gap: number | null, leaderV: number): number {
    return idmAccel(f.speed, gap, leaderV, { v0: Math.max(1, this.desiredSpeed(f)), ...DEFAULT_DRIVER });
  }

  /** Whether a player in lane `to` keeps PLAYER_HEADWAY to a car moving in at path distance `s`, and need not brake hard. */
  private playerClear(a: Agent, to: LaneRef, s: number, player: PlayerState): boolean {
    const path = this.net.path(to);
    if (dist(player.position, a.position) > path.length + player.length) return true;
    let ps = project(path.points, player.position);
    const at = pointAt(path.points, ps);
    const half = this.world.laneWidth(to.edgeId) / 2 + player.width / 2;
    const [dx, dz] = [player.position[0] - at.position[0], player.position[1] - at.position[1]];
    const along = dx * Math.sin(at.heading) + dz * Math.cos(at.heading);
    if (ps === 0 && along < 0) {
      // Still in the junction behind the lane start: one heading into the lane counts at its distance short of it.
      const across = Math.abs(dx * Math.cos(at.heading) - dz * Math.sin(at.heading));
      if (across >= 2 * half || Math.abs(wrapAngle(player.heading - at.heading)) >= Math.PI / 2) return true;
      ps = -Math.hypot(dx, dz);
    } else if (dist(at.position, player.position) >= half) {
      return true;
    }
    const vp = Math.max(0, player.speed * Math.cos(player.heading - at.heading));
    const halves = (a.length + player.length) / 2;
    if (ps < s) {
      const gap = s - ps - halves;
      if (gap < PLAYER_HEADWAY * vp + DEFAULT_DRIVER.s0) return false;
      const v0 = Math.max(1, vp, this.desiredSpeed(a));
      return idmAccel(vp, gap, a.speed, { v0, ...DEFAULT_DRIVER }) >= SAFE_BRAKE;
    }
    return ps - s - halves >= PLAYER_HEADWAY * a.speed + DEFAULT_DRIVER.s0;
  }

  private turnBias(a: Agent, to: LaneRef): number {
    const next = a.route[0];
    if (!next) return 0;
    const turn = turnBetween(this.net, a.ref, next);
    if (turn === 'straight') return 0;
    const need = turn === 'right' ? 0 : this.laneCount(a.ref) - 1;
    return Math.abs(to.lane - need) < Math.abs(a.ref.lane - need) ? TURN_BIAS : -TURN_BIAS;
  }

  /** Room before the lane end or a stop line on it, less `travel`, leaves CLEAR_OF_END. */
  private clearAhead(ref: LaneRef, s: number, travel: number): boolean {
    const p = this.net.path(ref);
    let room = p.length - s;
    const light = this.world.signals.approachState(ref.edgeId, ref.dir, this.net.edgeS(ref, s), [p.startAt, p.endAt]);
    if (light) room = Math.min(room, this.net.pathS(ref, light.stopAt) - s);
    return room - travel >= CLEAR_OF_END;
  }

  /** Cars on `ref` and changing cars crossing to or from it, sorted by path distance on it, without `skip`. */
  private occupants(ref: LaneRef, skip: Agent): Occupant[] {
    const out: Occupant[] = [];
    for (const b of this.byPiece.get(laneKey(ref)) ?? []) if (b !== skip) out.push({ a: b, s: b.s });
    for (const b of this.beside.get(laneKey(ref)) ?? []) if (b !== skip) out.push({ a: b, s: this.mapS(b.ref, b.s, ref) });
    for (const b of this.arriving.get(laneKey(ref)) ?? []) if (b.conn) out.push({ a: b, s: b.s - b.conn.length });
    return out.sort((x, y) => x.s - y.s);
  }

  /** Nearest car moving across into, or still partly in, the agent's lane ahead of it. */
  private mergerAhead(a: Agent): Obstacle | null {
    let best: Obstacle | null = null;
    const lane = a.conn ? a.conn.to : a.ref;
    const s = a.conn ? a.s - a.conn.length : a.s;
    for (const b of this.beside.get(laneKey(lane)) ?? []) {
      if (b === a || !b.changing || b.changing.t <= 0) continue;
      const d = this.mapS(b.ref, b.s, lane) - s;
      if (d <= 0) continue;
      const gap = d - (a.length + b.length) / 2;
      if (!best || gap < best.gap) best = { gap, speed: b.speed };
    }
    return best;
  }

  /** The agent as if it were on `ref`, for looking ahead in a lane it is not indexed on. */
  private ghost(a: Agent, ref: LaneRef, s = this.mapS(a.ref, a.s, ref)): Agent {
    return { ...a, ref, s, next: null, nextConn: null, conn: null, changing: null };
  }

  private otherLane(a: Agent): LaneRef {
    const ch = a.changing!;
    return a.ref === ch.from ? ch.to : ch.from;
  }

  private mapS(from: LaneRef, s: number, to: LaneRef): number {
    return (s / this.net.path(from).length) * this.net.path(to).length;
  }

  private laneCount(ref: LaneRef): number {
    const e = this.edge(ref.edgeId);
    return ref.dir === 1 ? e.lanesForward : e.lanesBackward;
  }

  /** Carries the agent onto connectors and lanes; false once it has despawned. */
  private moveAlong(a: Agent): boolean {
    for (;;) {
      if (a.conn) {
        if (a.s < a.conn.length) return true;
        a.s -= a.conn.length;
        this.leaveNode(a);
        this.release(a.conn.node, a.id);
        a.ref = a.conn.to;
        a.conn = a.next = a.nextConn = null;
        a.rest = 0;
        a.stopDone = false;
        continue;
      }
      if (a.changing && a.s >= this.net.path(a.ref).length) this.endChange(a);
      const len = this.net.path(a.ref).length;
      if (a.s < len) return true;
      if (!a.next && !a.trapped) this.chooseNext(a);
      if (!a.next || !a.nextConn) {
        this.despawn(a);
        return false;
      }
      // A car still moving at the line is one the lookahead found too close to stop; priority lets it through.
      const moving = a.speed > MOVING;
      if (this.mustHold(a, a.ref, moving)) {
        a.s = len;
        a.speed = 0;
        return true;
      }
      const node = this.gatedNode(a.ref);
      if (node) {
        const approach = approachKey(a.ref);
        // The gate, not the obstacle, is what keeps two approaches out of the junction in the same step.
        if (!this.canEnter(node, approach, len >= a.length && !moving) || !this.hasRoom(a.next, a.length)) {
          a.s = len;
          a.speed = 0;
          return true;
        }
        this.take(node, approach, a.id);
      }
      a.s -= len;
      a.conn = a.nextConn;
      if (node) {
        addTo(this.onNode, node, a);
        addTo(this.entering, laneKey(a.next), a);
      }
    }
  }

  private chooseNext(a: Agent): void {
    const forced = a.route.shift();
    let exits = forced ? [forced] : this.net.exits(a.ref, this.signs);
    // A car turned into a dead end comes straight back through the junction, which can lock it with the next car in.
    const through = exits.filter(r => !this.deadEnds.has(this.endNode(r)));
    if (through.length) exits = through;
    if (!exits.length) {
      a.trapped = true;
      return;
    }
    if (!forced) {
      // Turning from an inner lane would cut across the car beside it; a car never changes lane once it has chosen, so it goes on.
      const e = this.edge(a.ref.edgeId);
      const lanes = a.ref.dir === 1 ? e.lanesForward : e.lanesBackward;
      const fits = exits.filter(r => {
        const turn = turnBetween(this.net, a.ref, r);
        if (turn === 'right') return a.ref.lane === 0;
        if (turn === 'left' || turn === 'uturn') return a.ref.lane === lanes - 1;
        return true;
      });
      if (fits.length) exits = fits;
    }
    a.next = exits[Math.floor(this.rand() * exits.length)];
    a.nextConn = this.conn(a.ref, a.next);
  }

  private desiredSpeed(a: Agent): number {
    const e = this.edge(a.ref.edgeId);
    const target = ((e.maxspeed > 0 ? e.maxspeed : DEFAULT_KMH) / 3.6) * a.factor;
    if (a.conn) return Math.min(target, a.conn.turn);
    if (a.nextConn && a.nextConn.turn < target) {
      const toEnd = this.net.path(a.ref).length - a.s;
      if (toEnd <= TURN_ZONE) return Math.min(target, Math.sqrt(a.nextConn.turn ** 2 + 2 * TURN_DECEL * Math.max(0, toEnd)));
    }
    return target;
  }

  private conn(from: LaneRef, to: LaneRef): Conn {
    const key = `${laneKey(from)}>${laneKey(to)}`;
    let c = this.conns.get(key);
    if (c) return c;
    const a = this.net.path(from).points, b = this.net.path(to).points;
    const inH = Math.atan2(a[a.length - 1][0] - a[a.length - 2][0], a[a.length - 1][1] - a[a.length - 2][1]);
    const outH = Math.atan2(b[1][0] - b[0][0], b[1][1] - b[0][1]);
    const points = this.net.connector(from, to);
    c = {
      key, from, to, points, length: polyLength(points), node: this.endNode(from),
      turn: turnSpeed(wrapAngle(outH - inH)), kind: turnBetween(this.net, from, to),
    };
    this.conns.set(key, c);
    return c;
  }

  private endNode(ref: LaneRef): string {
    const e = this.edge(ref.edgeId);
    return ref.dir === 1 ? e.to : e.from;
  }

  private gatedNode(ref: LaneRef): string | null {
    const node = this.endNode(ref);
    return this.gated.has(node) ? node : null;
  }

  /** `priority` false for a lane shorter than the car: it cannot wait there without blocking the junction behind. */
  private canEnter(node: string, approach: string, priority = true): boolean {
    for (const b of this.onNode.get(node) ?? []) if (b.conn && approachKey(b.conn.from) !== approach) return false;
    const r = this.reservations.get(node);
    if (r) return r.approach === approach && this.time - r.since < PLATOON_WINDOW;
    return !this.yielding(node, approach) && (!priority || this.hasPriority(node, approach));
  }

  private yielding(node: string, approach: string): boolean {
    const y = this.yields.get(node);
    return !!y && y.approach === approach && this.time < y.until;
  }

  /** Whether no other car, nor the player, about to reach this free junction goes before `approach`. */
  private hasPriority(node: string, approach: string): boolean {
    const me = this.approaches.get(approach);
    if (!me) return true;
    const player = this.playerAt.get(node);
    if (player && player.key !== approach && this.precedes(player, me)) return false;
    const next = this.goesNext.get(node);
    if (next) return next === approach;
    for (const [k, c] of this.contenders.get(node) ?? []) {
      if (k !== approach && c.permitted && this.precedes(c.info, me)) return false;
    }
    return true;
  }

  /** Higher rank first; between equals, the approach arriving from the other's right. */
  private precedes(b: ApproachInfo, a: ApproachInfo): boolean {
    return b.rank > a.rank || (b.rank === a.rank && classifyTurn(a.heading, b.heading) === 'left');
  }

  /** Stop-sign stops, and left turns across a straight-bound oncoming car at a junction without a reservation gate. */
  private mustHold(a: Agent, ref: LaneRef, committed: boolean): boolean {
    const current = !a.conn && laneKey(ref) === laneKey(a.ref);
    if (this.stopSigns.has(approachKey(ref)) && !(current && a.stopDone)) return true;
    if (committed || !current || a.nextConn?.kind !== 'left' || this.gated.has(this.endNode(ref))) return false;
    return (this.oncoming.get(approachKey(ref)) ?? []).some(k => this.threats.has(k));
  }

  private arbitrate(player: PlayerState): void {
    this.contenders.clear();
    this.playerAt.clear();
    this.goesNext.clear();
    this.threats.clear();
    const leads = new Map<string, { a: Agent; tta: number }>();
    for (const a of this.pool) {
      if (!a.active) continue;
      if (a.conn) {
        if (a.conn.kind === 'straight' && a.speed > MOVING && !this.gated.has(a.conn.node)) this.threats.add(approachKey(a.conn.from));
        continue;
      }
      const list = this.byPiece.get(laneKey(a.ref))!;
      if (list[list.length - 1] !== a) continue;
      const k = approachKey(a.ref);
      if (!this.approaches.has(k)) continue;
      const toEnd = this.net.path(a.ref).length - a.s - a.length / 2;
      const tta = Math.max(0, toEnd) / Math.max(a.speed, 0.1);
      const prev = leads.get(k);
      if (!prev || tta < prev.tta) leads.set(k, { a, tta });
    }
    const held = (node: string, k: string) => this.time - (this.waiting.get(node)?.get(k) ?? -Infinity) <= WAIT_FRESH;
    const since = (node: string, k: string) => this.arrivals.get(node)?.get(k) ?? this.time;
    for (const [k, { a, tta }] of leads) {
      const info = this.approaches.get(k)!;
      if (!this.gated.has(info.node)) {
        // A car standing still, for a crossing or a light, is no threat until it moves off.
        if (a.speed > MOVING && tta < PRIORITY_TTA && (!a.nextConn || a.nextConn.kind === 'straight')) this.threats.add(k);
      } else if (tta < PRIORITY_TTA || held(info.node, k)) {
        const permitted = !this.yielding(info.node, k) && (!a.next || this.hasRoom(a.next, a.length));
        addContender(this.contenders, info.node, k, { info, since: since(info.node, k), permitted });
      }
    }
    for (const [node, m] of this.waiting) {
      for (const k of m.keys()) {
        const info = this.approaches.get(k);
        if (!info || leads.has(k) || !held(node, k)) continue;
        addContender(this.contenders, node, k, { info, since: since(node, k), permitted: !this.yielding(node, k) });
      }
    }
    this.arrivals.clear();
    for (const [node, m] of this.contenders) this.arrivals.set(node, new Map([...m].map(([k, c]) => [k, c.since])));
    for (const [node, m] of this.contenders) {
      const permitted = [...m].filter(([, c]) => c.permitted).sort((x, y) => x[1].since - y[1].since);
      if (!permitted.length) continue;
      const [first, c] = permitted[0];
      // Equal approaches on every arm each have one on their right; the one waiting longest breaks the circle.
      const circle = permitted.every(([k, x]) => permitted.some(([j, y]) => j !== k && this.precedes(y.info, x.info)));
      if (circle || this.time - c.since > STARVED) this.goesNext.set(node, first);
    }
    const p = this.playerApproach(player);
    if (p && this.gated.has(p.node)) this.playerAt.set(p.node, p);
    else if (p) this.threats.add(p.key);
  }

  /** The approach the player is about to drive into a junction on, treated as going straight. */
  private playerApproach(player: PlayerState): (ApproachInfo & { key: string }) | null {
    if (player.speed < MOVING) return null;
    const lane = nearestLane(this.d, player.position[0], player.position[1], PLAYER_SNAP);
    if (!lane) return null;
    const dir = Math.abs(wrapAngle(player.heading - lane.heading)) < Math.PI / 2 ? 1 : -1;
    const ref: LaneRef = { edgeId: lane.edge.id, dir, lane: 0 };
    const key = approachKey(ref);
    const info = this.approaches.get(key);
    if (!info) return null;
    const path = this.net.path(ref);
    const toEnd = path.length - project(path.points, player.position) - player.length / 2;
    return Math.max(0, toEnd) / player.speed < PRIORITY_TTA ? { ...info, key } : null;
  }

  /**
   * Whether a car entering `next` can get clear of the junction behind it. Without this two cars crossing
   * neighbouring junctions toward each other each stop on a connector waiting for the other's junction.
   */
  private hasRoom(next: LaneRef, length: number, chained = true): boolean {
    // A moving car ahead is a stream to follow, not a queue to wait behind.
    let limit = Infinity;
    for (const b of this.byPiece.get(laneKey(next)) ?? []) {
      if (b.speed <= MOVING) {
        limit = b.s - b.length / 2;
        break;
      }
    }
    for (const b of this.entering.get(laneKey(next)) ?? []) {
      if (b.conn && b.speed <= MOVING) limit = Math.min(limit, b.s - b.conn.length - b.length / 2);
    }
    const end = chained ? this.gatedNode(next) : null;
    // Priority is left out here: two close junctions can each give way to the car waiting to cross the other.
    if (end && !this.canEnter(end, approachKey(next), false)) limit = Math.min(limit, this.net.path(next).length);
    return limit >= length + DEFAULT_DRIVER.s0;
  }

  private take(node: string, approach: string, id: number): void {
    this.arrivals.get(node)?.delete(approach);
    const r = this.reservations.get(node);
    if (r) {
      r.holders.add(id);
      r.lastActive = this.time;
      return;
    }
    this.reservations.set(node, { approach, holders: new Set([id]), since: this.time, lastActive: this.time });
    if (this.yields.get(node)?.approach !== approach) this.yields.delete(node);
    this.waiting.get(node)?.delete(approach);
  }

  private release(node: string, id: number): void {
    const r = this.reservations.get(node);
    if (!r) return;
    r.holders.delete(id);
    if (r.holders.size) return;
    this.reservations.delete(node);
    // Without this the stream that just drained re-takes the node before a car waiting from rest can reach it.
    for (const [approach, seen] of this.waiting.get(node) ?? []) {
      if (approach !== r.approach && this.time - seen <= WAIT_FRESH) {
        this.yields.set(node, { approach: r.approach, until: this.time + YIELD_TIME });
        break;
      }
    }
  }

  private leaveNode(a: Agent): void {
    if (!a.conn) return;
    this.onNode.get(a.conn.node)?.delete(a);
    this.entering.get(laneKey(a.conn.to))?.delete(a);
  }

  private despawn(a: Agent): void {
    this.leaveNode(a);
    if (a.conn) this.release(a.conn.node, a.id);
    a.active = false;
    a.speed = 0;
  }

  private buildIndex(): void {
    this.byPiece.clear();
    this.byLeaving.clear();
    this.beside.clear();
    this.arriving.clear();
    const push = (m: Map<string, Agent[]>, k: string, a: Agent) => {
      const list = m.get(k);
      if (list) list.push(a);
      else m.set(k, [a]);
    };
    for (const a of this.pool) {
      if (!a.active) continue;
      if (a.conn) {
        push(this.byPiece, a.conn.key, a);
        push(this.byLeaving, laneKey(a.conn.from), a);
        push(this.arriving, laneKey(a.conn.to), a);
      } else {
        push(this.byPiece, laneKey(a.ref), a);
        if (a.changing) push(this.beside, laneKey(this.otherLane(a)), a);
      }
    }
    for (const list of this.byPiece.values()) list.sort((x, y) => x.s - y.s);
    for (const list of this.byLeaving.values()) list.sort((x, y) => x.s - y.s);
  }

  private fill(player: PlayerState, minDist: number): void {
    let missing = this.count - this.pool.reduce((n, a) => n + (a.active ? 1 : 0), 0);
    let attempts = missing * SPAWN_ATTEMPTS;
    while (missing > 0 && attempts-- > 0 && this.spawnTotal > 0) {
      const ref = this.pickLane(this.rand() * this.spawnTotal);
      const path = this.net.path(ref);
      const s = this.rand() * path.length;
      const { position } = pointAt(path.points, s);
      const fromPlayer = dist(position, player.position);
      if (fromPlayer < minDist || fromPlayer > SPAWN_MAX) continue;
      // Euclidean spacing also bounds spacing along the lane, which is never shorter.
      if (this.pool.some(a => a.active && dist(a.position, position) < SPAWN_SPACING)) continue;
      this.create(ref, s, pickClass(this.rand()));
      missing--;
    }
  }

  private pickLane(x: number): LaneRef {
    let lo = 0, hi = this.spawnLanes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.spawnLanes[mid].cum < x) lo = mid + 1;
      else hi = mid;
    }
    return this.spawnLanes[lo].ref;
  }

  private create(ref: LaneRef, s: number, carClass: CarClass, speed?: number): Agent {
    let id = this.pool.findIndex(a => !a.active);
    if (id < 0) id = this.pool.length;
    const p = pointAt(this.net.path(ref).points, s);
    const a: Agent = {
      id, active: true, position: p.position, heading: p.heading, carClass,
      colour: pickPaint(this.rand(), carClass), braking: false, speed: 0, indicator: null,
      ref, s, conn: null, next: null, nextConn: null, route: [], trapped: false,
      factor: 0.85 + 0.15 * this.rand(), length: CAR_CLASSES[carClass].length,
      generation: (this.pool[id]?.generation ?? 0) + 1, still: 0, rest: 0, stopDone: false, heldByPlayer: false,
      changing: null, considerAt: this.time + CONSIDER_EVERY * this.laneRand(),
    };
    a.speed = speed ?? 0.6 * this.desiredSpeed(a);
    this.pool[id] = a;
    return a;
  }

  private edge(id: string): GraphEdge {
    const e = this.edges.get(id);
    if (!e) throw new Error(`unknown edge ${id}`);
    return e;
  }
}

function addContender(m: Map<string, Map<string, Contender>>, node: string, approach: string, c: Contender): void {
  const inner = m.get(node);
  if (inner) inner.set(approach, c);
  else m.set(node, new Map([[approach, c]]));
}

function addTo<K, V>(m: Map<K, Set<V>>, k: K, v: V): void {
  const set = m.get(k);
  if (set) set.add(v);
  else m.set(k, new Set([v]));
}

function nearer(a: Obstacle | null, b: Obstacle | null): Obstacle | null {
  return !a || (b && b.gap < a.gap) ? b : a;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
