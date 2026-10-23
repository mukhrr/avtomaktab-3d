import { FOOT_KINDS } from '../../tools/city/extract';
import type { DistrictData, Vec2 } from '../shared/district';
import { rng } from '../sim/rng';
import type { SignalSystem } from '../sim/signals';
import type { AgentView, CrossingOccupancy, PlayerState } from '../traffic/trafficSim';
import { pointAlong } from '../world/roadGeometry';

export interface PedView {
  id: number;
  active: boolean;
  position: Vec2;
  heading: number;
  colour: number;
  walking: boolean;
}

interface CrossingGeom {
  id: string;
  kind: 'signal' | 'zebra' | 'unmarked';
  centre: Vec2;
  /** Unit vector along the road, and across it. */
  tangent: Vec2;
  normal: Vec2;
  half: number;
}

interface Footway {
  points: Vec2[];
  length: number;
}

interface Ped extends PedView {
  kind: 'crosser' | 'walker';
  speed: number;
  /** Crosser: crossing index, signed offset across the road, offset along it, state, travel direction across. */
  crossing: number;
  across: number;
  along: number;
  state: 'waiting' | 'crossing' | 'leaving';
  dir: 1 | -1;
  leaveDir: 1 | -1;
  left: number;
  /** Walker: footway index and distance along it. */
  footway: number;
  s: number;
}

const CROSSER_RANGE = 150;
const CROSSER_LEAVE = 200;
const WALKER_RANGE = 200;
const WALKER_LEAVE = 250;
const MIN_SPAWN_DIST = 9;
const CURB_MARGIN = 1.5;
const LEAVE_DISTANCE = 15;
const SPAWN_JITTER = 1;
const SPAWN_ATTEMPTS = 10;
const ZEBRA_GAP = 2;
const UNMARKED_GAP = 4;
const CAR_CORRIDOR = 5;
const CAR_TAIL = 3;
const HIT_MARGIN = 0.3;
const CROSS_SPEED: [number, number] = [1.2, 1.5];
const WALK_SPEED: [number, number] = [1.1, 1.5];
const COLOURS = [0x3b4a6b, 0x7a3b3b, 0x4f6b3b, 0x8a7a55, 0x2e2e33, 0xb0a79a, 0x5b3b6b, 0x9a4f2e];

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function polyLength(pts: Vec2[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += dist(pts[i - 1], pts[i]);
  return d;
}

/** Seconds until a car moving along its heading reaches `point`, or Infinity if the point is not in its path. */
function timeToArrival(position: Vec2, heading: number, speed: number, point: Vec2): number {
  const sign = speed < 0 ? -1 : 1;
  const fx = Math.sin(heading) * sign, fz = Math.cos(heading) * sign;
  const dx = point[0] - position[0], dz = point[1] - position[1];
  const ahead = dx * fx + dz * fz;
  if (Math.abs(dx * fz - dz * fx) > CAR_CORRIDOR || ahead < -CAR_TAIL) return Infinity;
  return Math.max(ahead, 0) / Math.max(Math.abs(speed), 0.1);
}

export class PedSim implements CrossingOccupancy {
  private readonly pool: Ped[] = [];
  readonly peds: readonly PedView[] = this.pool;
  private readonly rand: () => number;
  private readonly crossings: CrossingGeom[] = [];
  private readonly crossingIndex = new Map<string, number>();
  private readonly footways: Footway[] = [];
  private readonly footwayTotal: number;
  private readonly clear = new Map<number, boolean>();

  constructor(d: DistrictData, opts: { crossers: number; walkers: number; seed: number }) {
    this.rand = rng(opts.seed);
    const edges = new Map(d.graph.edges.map(e => [e.id, e]));
    for (const c of d.crossings) {
      const edge = edges.get(c.edgeId);
      if (!edge) continue;
      const h = pointAlong(edge.points, c.at).heading;
      const tangent: Vec2 = [Math.sin(h), Math.cos(h)];
      this.crossingIndex.set(c.id, this.crossings.length);
      this.crossings.push({
        id: c.id, kind: c.kind, centre: c.position, tangent,
        normal: [-tangent[1], tangent[0]], half: c.width / 2 + CURB_MARGIN,
      });
    }
    for (const r of d.roads) {
      if (!FOOT_KINDS.has(r.kind) || r.points.length < 2) continue;
      const length = polyLength(r.points);
      if (length > 0) this.footways.push({ points: r.points, length });
    }
    this.footwayTotal = this.footways.reduce((s, f) => s + f.length, 0);
    const total = opts.crossers + opts.walkers;
    for (let i = 0; i < total; i++) {
      this.pool.push({
        id: i, active: false, position: [0, 0], heading: 0, colour: COLOURS[0], walking: false,
        kind: i < opts.crossers ? 'crosser' : 'walker', speed: 0,
        crossing: 0, across: 0, along: 0, state: 'waiting', dir: 1, leaveDir: 1, left: 0, footway: 0, s: 0,
      });
    }
  }

  step(dt: number, player: PlayerState, cars: readonly AgentView[], signals: SignalSystem): void {
    this.clear.clear();
    for (const p of this.pool) {
      if (!p.active) continue;
      if (p.kind === 'crosser') this.stepCrosser(p, dt, player, cars, signals);
      else this.stepWalker(p, dt, player);
    }
    this.spawn(player);
  }

  occupied(crossingId: string): boolean {
    const k = this.crossingIndex.get(crossingId);
    return k !== undefined && this.pool.some(p => p.active && p.kind === 'crosser' && p.crossing === k && p.state === 'crossing');
  }

  hitTest(player: PlayerState): number[] {
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    const halfL = player.length / 2 + HIT_MARGIN, halfW = player.width / 2 + HIT_MARGIN;
    const hits: number[] = [];
    for (const p of this.pool) {
      if (!p.active) continue;
      const dx = p.position[0] - player.position[0], dz = p.position[1] - player.position[1];
      if (Math.abs(dx * fx + dz * fz) <= halfL && Math.abs(dx * fz - dz * fx) <= halfW) hits.push(p.id);
    }
    return hits;
  }

  remove(id: number): void {
    const p = this.pool[id];
    if (p) p.active = false;
  }

  private stepCrosser(p: Ped, dt: number, player: PlayerState, cars: readonly AgentView[], signals: SignalSystem): void {
    const x = this.crossings[p.crossing];
    if (p.state === 'waiting' && dist(p.position, player.position) > CROSSER_LEAVE) {
      p.active = false;
      return;
    }
    if (p.state === 'waiting') {
      if (!this.mayCross(p.crossing, player, cars, signals)) return;
      p.state = 'crossing';
      p.walking = true;
    }
    if (p.state === 'crossing') {
      p.across += p.dir * p.speed * dt;
      if (p.dir * (p.across - p.dir * x.half) >= 0) {
        p.across = p.dir * x.half;
        p.state = 'leaving';
      }
    } else {
      p.left += p.speed * dt;
      if (p.left >= LEAVE_DISTANCE) {
        p.active = false;
        return;
      }
    }
    this.placeCrosser(p, x);
  }

  private placeCrosser(p: Ped, x: CrossingGeom): void {
    const along = p.along + (p.state === 'leaving' ? p.left * p.leaveDir : 0);
    p.position[0] = x.centre[0] + x.normal[0] * p.across + x.tangent[0] * along;
    p.position[1] = x.centre[1] + x.normal[1] * p.across + x.tangent[1] * along;
    const hx = p.state === 'leaving' ? x.tangent[0] * p.leaveDir : x.normal[0] * p.dir;
    const hz = p.state === 'leaving' ? x.tangent[1] * p.leaveDir : x.normal[1] * p.dir;
    p.heading = Math.atan2(hx, hz);
  }

  private mayCross(k: number, player: PlayerState, cars: readonly AgentView[], signals: SignalSystem): boolean {
    const cached = this.clear.get(k);
    if (cached !== undefined) return cached;
    const x = this.crossings[k];
    const walk = x.kind === 'signal' ? signals.walkState(x.id) : null;
    let ok: boolean;
    if (walk !== null) ok = walk === 'walk';
    else {
      const gap = x.kind === 'zebra' ? ZEBRA_GAP : UNMARKED_GAP;
      const blocked = (c: { position: Vec2; heading: number; speed: number }) =>
        timeToArrival(c.position, c.heading, c.speed, x.centre) < gap;
      ok = !cars.some(c => c.active && blocked(c)) && (x.kind === 'zebra' || !blocked(player));
    }
    this.clear.set(k, ok);
    return ok;
  }

  private stepWalker(p: Ped, dt: number, player: PlayerState): void {
    if (dist(p.position, player.position) > WALKER_LEAVE) {
      p.active = false;
      return;
    }
    const f = this.footways[p.footway];
    p.s += p.dir * p.speed * dt;
    if (p.s < 0) {
      p.s = -p.s;
      p.dir = 1;
    } else if (p.s > f.length) {
      p.s = 2 * f.length - p.s;
      p.dir = -1;
    }
    this.placeWalker(p, f);
  }

  private placeWalker(p: Ped, f: Footway): void {
    const at = pointAlong(f.points, p.s);
    p.position[0] = at.x;
    p.position[1] = at.z;
    p.heading = p.dir === 1 ? at.heading : at.heading + Math.PI;
  }

  private spawn(player: PlayerState): void {
    let near: number[] | null = null;
    for (const p of this.pool) {
      if (p.active) continue;
      if (p.kind === 'crosser') {
        near ??= this.crossings.flatMap((x, k) => (dist(x.centre, player.position) <= CROSSER_RANGE ? [k] : []));
        if (near.length) this.spawnCrosser(p, near, player);
      } else if (this.footwayTotal > 0) this.spawnWalker(p, player);
    }
  }

  private spawnCrosser(p: Ped, near: number[], player: PlayerState): void {
    for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
      const k = near[Math.floor(this.rand() * near.length)];
      const x = this.crossings[k];
      const side: 1 | -1 = this.rand() < 0.5 ? -1 : 1;
      const along = (this.rand() * 2 - 1) * SPAWN_JITTER;
      const px = x.centre[0] + x.normal[0] * side * x.half + x.tangent[0] * along;
      const pz = x.centre[1] + x.normal[1] * side * x.half + x.tangent[1] * along;
      if (Math.hypot(px - player.position[0], pz - player.position[1]) < MIN_SPAWN_DIST) continue;
      p.crossing = k;
      p.across = side * x.half;
      p.along = along;
      p.dir = side === 1 ? -1 : 1;
      p.leaveDir = this.rand() < 0.5 ? -1 : 1;
      p.left = 0;
      p.state = 'waiting';
      p.walking = false;
      p.speed = CROSS_SPEED[0] + this.rand() * (CROSS_SPEED[1] - CROSS_SPEED[0]);
      this.activate(p);
      this.placeCrosser(p, x);
      return;
    }
  }

  private spawnWalker(p: Ped, player: PlayerState): void {
    for (let i = 0; i < SPAWN_ATTEMPTS; i++) {
      let pick = this.rand() * this.footwayTotal;
      let k = 0;
      while (k < this.footways.length - 1 && pick > this.footways[k].length) pick -= this.footways[k++].length;
      const f = this.footways[k];
      const s = Math.min(pick, f.length);
      const at = pointAlong(f.points, s);
      const d = Math.hypot(at.x - player.position[0], at.z - player.position[1]);
      if (d > WALKER_RANGE || d < MIN_SPAWN_DIST) continue;
      p.footway = k;
      p.s = s;
      p.dir = this.rand() < 0.5 ? -1 : 1;
      p.speed = WALK_SPEED[0] + this.rand() * (WALK_SPEED[1] - WALK_SPEED[0]);
      p.walking = true;
      this.activate(p);
      this.placeWalker(p, f);
      return;
    }
  }

  private activate(p: Ped): void {
    p.active = true;
    p.colour = COLOURS[Math.floor(this.rand() * COLOURS.length)];
  }
}
