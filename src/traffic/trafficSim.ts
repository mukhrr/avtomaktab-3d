import type { Crossing, DistrictData, GraphEdge, Vec2 } from '../shared/district';
import { rng } from '../sim/rng';
import type { SignalSystem } from '../sim/signals';
import { DEFAULT_DRIVER, idmAccel, turnSpeed } from './idm';
import { pointAt, type LaneNetwork, type LaneRef } from './lanes';
import { approachKey, laneKey, nearestObstacle, type LookaheadWorld } from './lookahead';

export interface PlayerState {
  position: Vec2;
  heading: number;
  /** Signed speed along `heading`, m/s. */
  speed: number;
  length: number;
  width: number;
}

export type CarClass = 'spark' | 'nexia' | 'cobalt' | 'damas' | 'bus';

export const CAR_CLASSES: Record<CarClass, { length: number; width: number; weight: number }> = {
  spark: { length: 3.6, width: 1.6, weight: 25 },
  nexia: { length: 4.5, width: 1.7, weight: 25 },
  cobalt: { length: 4.5, width: 1.74, weight: 30 },
  damas: { length: 3.5, width: 1.5, weight: 12 },
  bus: { length: 11, width: 2.5, weight: 8 },
};

export interface AgentView {
  id: number;
  active: boolean;
  position: Vec2;
  heading: number;
  carClass: CarClass;
  colour: number;
  braking: boolean;
  speed: number;
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
const MOVING = 0.5;
const SIGNAL_REACH = 40;
const PED_CONTROLLER = 'ped-';
const SPAWN_SPACING = 2 * 4.5;
const SPAWN_MAX = 300;
const SPAWN_MIN = 120;
const INITIAL_SPAWN_MIN = 30;
const DESPAWN_AT = 350;
const GRIDLOCK_TIME = 60;
const SPAWN_ATTEMPTS = 30;
const BRAKING = -1;
const DEFAULT_KMH = 60;
const COLOURS = [0xf2f2f2, 0x1c1c1c, 0xb8bcc2, 0x7a1f24, 0x1f3f7a, 0x2f5d3a, 0xd8c9a3, 0x5a5a5a];
const CLASSES = Object.keys(CAR_CLASSES) as CarClass[];
const WEIGHT_SUM = CLASSES.reduce((s, c) => s + CAR_CLASSES[c].weight, 0);

const polyLength = (pts: Vec2[]) => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
};

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class TrafficSim {
  private readonly pool: Agent[] = [];
  readonly agents: readonly AgentView[] = this.pool;
  private readonly rand: () => number;
  private readonly count: number;
  private readonly edges = new Map<string, GraphEdge>();
  private readonly crossingsByEdge = new Map<string, Crossing[]>();
  private readonly gated = new Set<string>();
  private readonly spawnLanes: { ref: LaneRef; cum: number }[] = [];
  private readonly spawnTotal: number;
  private readonly conns = new Map<string, Conn>();
  private readonly byPiece = new Map<string, Agent[]>();
  private readonly byLeaving = new Map<string, Agent[]>();
  private readonly reservations = new Map<string, Reservation>();
  /** Agents on a connector of each gated node, and on gated-node connectors into each lane (laneKey). */
  private readonly onNode = new Map<string, Set<Agent>>();
  private readonly entering = new Map<string, Set<Agent>>();
  private readonly deadEnds = new Set<string>();
  private readonly yields = new Map<string, { approach: string; until: number }>();
  /** Per gated node, approaches whose lead car is held at it, with the time it was last seen waiting. */
  private readonly waiting = new Map<string, Map<string, number>>();
  private readonly world: LookaheadWorld;
  private time = 0;
  private started = false;

  constructor(d: DistrictData, private readonly net: LaneNetwork, signals: SignalSystem, opts: { count: number; seed: number }) {
    this.rand = rng(opts.seed);
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
    for (const n of d.graph.nodes) {
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
      canEnter: (node, approach, next, length) => this.canEnter(node, approach) && (!next || this.hasRoom(next, length)),
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
      // Exclusive junctions can lock in a ring of short edges; a car stuck that long out of sight is cleared instead.
      if (d > DESPAWN_AT || (a.still > GRIDLOCK_TIME && d > SPAWN_MIN)) this.despawn(a);
    }
    this.buildIndex();
    for (const a of this.pool) if (a.active) this.advance(a, dt, player, crossings);
    this.fill(player, this.started ? SPAWN_MIN : INITIAL_SPAWN_MIN);
    this.started = true;
  }

  reservationHolder(nodeId: string): number | null {
    const r = this.reservations.get(nodeId);
    if (!r) return null;
    for (const id of r.holders) return id;
    return null;
  }

  /** Puts an agent at path distance `s` on `ref`; `route` overrides the random choice at the next junctions. */
  place(ref: LaneRef, s: number, opts: { speed?: number; carClass?: CarClass; route?: LaneRef[] } = {}): number {
    const a = this.create(ref, s, opts.carClass ?? this.pickClass(), opts.speed);
    a.route = [...(opts.route ?? [])];
    return a.id;
  }

  inspect(id: number): { ref: LaneRef; s: number; connectorNode: string | null; generation: number } | null {
    const a = this.pool[id];
    if (!a || !a.active) return null;
    return { ref: a.ref, s: a.s, connectorNode: a.conn?.node ?? null, generation: a.generation };
  }

  private advance(a: Agent, dt: number, player: PlayerState, crossings: CrossingOccupancy): void {
    if (!a.conn && !a.next && !a.trapped && this.net.path(a.ref).length - a.s <= CHOOSE_AT) this.chooseNext(a);
    const v0 = Math.max(1, this.desiredSpeed(a));
    const ob = nearestObstacle(a, this.world, player, crossings);
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
    const acc = idmAccel(a.speed, ob ? ob.gap : null, ob ? ob.speed : 0, { v0, ...DEFAULT_DRIVER });
    a.speed = Math.max(0, a.speed + acc * dt);
    a.braking = acc < BRAKING;
    a.still = a.speed < MOVING ? a.still + dt : 0;
    a.s += a.speed * dt;
    if (!this.moveAlong(a)) return;
    const p = pointAt(a.conn ? a.conn.points : this.net.path(a.ref).points, a.s);
    a.position = p.position;
    a.heading = p.heading;
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
        continue;
      }
      const len = this.net.path(a.ref).length;
      if (a.s < len) return true;
      if (!a.next && !a.trapped) this.chooseNext(a);
      if (!a.next || !a.nextConn) {
        this.despawn(a);
        return false;
      }
      const node = this.gatedNode(a.ref);
      if (node) {
        const approach = approachKey(a.ref);
        // The gate, not the obstacle, is what keeps two approaches out of the junction in the same step.
        if (!this.canEnter(node, approach) || !this.hasRoom(a.next, a.length)) {
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
    let exits = forced ? [forced] : this.net.exits(a.ref);
    // A car turned into a dead end comes straight back through the junction, which can lock it with the next car in.
    const through = exits.filter(r => !this.deadEnds.has(this.endNode(r)));
    if (through.length) exits = through;
    if (!exits.length) {
      a.trapped = true;
      return;
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
    c = { key, from, to, points, length: polyLength(points), node: this.endNode(from), turn: turnSpeed(wrapAngle(outH - inH)) };
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

  private canEnter(node: string, approach: string): boolean {
    for (const b of this.onNode.get(node) ?? []) if (b.conn && approachKey(b.conn.from) !== approach) return false;
    const r = this.reservations.get(node);
    if (r) return r.approach === approach && this.time - r.since < PLATOON_WINDOW;
    const y = this.yields.get(node);
    return !(y && y.approach === approach && this.time < y.until);
  }

  /**
   * Whether a car entering `next` can get clear of the junction behind it. Without this two cars crossing
   * neighbouring junctions toward each other each stop on a connector waiting for the other's junction.
   */
  private hasRoom(next: LaneRef, length: number): boolean {
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
    const end = this.gatedNode(next);
    if (end && !this.canEnter(end, approachKey(next))) limit = Math.min(limit, this.net.path(next).length);
    return limit >= length + DEFAULT_DRIVER.s0;
  }

  private take(node: string, approach: string, id: number): void {
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
      } else {
        push(this.byPiece, laneKey(a.ref), a);
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
      this.create(ref, s, this.pickClass());
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

  private pickClass(): CarClass {
    let x = this.rand() * WEIGHT_SUM;
    for (const c of CLASSES) {
      x -= CAR_CLASSES[c].weight;
      if (x < 0) return c;
    }
    return CLASSES[CLASSES.length - 1];
  }

  private create(ref: LaneRef, s: number, carClass: CarClass, speed?: number): Agent {
    let id = this.pool.findIndex(a => !a.active);
    if (id < 0) id = this.pool.length;
    const p = pointAt(this.net.path(ref).points, s);
    const a: Agent = {
      id, active: true, position: p.position, heading: p.heading, carClass,
      colour: COLOURS[Math.floor(this.rand() * COLOURS.length)], braking: false, speed: 0,
      ref, s, conn: null, next: null, nextConn: null, route: [], trapped: false,
      factor: 0.85 + 0.15 * this.rand(), length: CAR_CLASSES[carClass].length,
      generation: (this.pool[id]?.generation ?? 0) + 1, still: 0,
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

function addTo<K, V>(m: Map<K, Set<V>>, k: K, v: V): void {
  const set = m.get(k);
  if (set) set.add(v);
  else m.set(k, new Set([v]));
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
