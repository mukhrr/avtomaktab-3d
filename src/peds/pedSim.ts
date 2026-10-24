import { FOOT_KINDS } from '../../tools/city/extract';
import type { DistrictData, Vec2 } from '../shared/district';
import { rng } from '../sim/rng';
import type { SignalSystem } from '../sim/signals';
import { CAR_CLASSES } from '../traffic/carClasses';
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
  /** The road the crossing spans. */
  road: string;
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
  /** Crosser: the walk off the crossing, kept clear of every carriageway. */
  leavePath: Vec2[];
  leaveLength: number;
  /** Walker: footway index and distance along it. */
  footway: number;
  s: number;
}

const ROAD_MARGIN = 0.5;
const MIN_RUN = 5;
const SAMPLE_STEP = 1;
const CELL = 100;
const WALKER_ATTEMPTS_PER_STEP = 20;
const CROSSER_RANGE = 150;
const CROSSER_LEAVE = 200;
const WALKER_RANGE = 200;
const WALKER_LEAVE = 250;
const MIN_SPAWN_DIST = 40;
const CURB_MARGIN = 1.5;
const LEAVE_DISTANCE = 15;
/** How far a leaving crosser may step out from the kerb to get clear of the carriageway. */
const LEAVE_OUT_MAX = 6;
const LEAVE_SAMPLE = 0.5;
const SPAWN_JITTER = 1;
const SPAWN_ATTEMPTS = 10;
const ZEBRA_GAP = 2;
const UNMARKED_GAP = 4;
const CAR_CORRIDOR = 5;
const CAR_TAIL = 3;
/** A car whose front has stood this close to an unsignalled crossing for WAITER_STARVED gets the next gap: new crossers wait for it. */
const WAITER_REACH = 6;
const WAITER_STARVED = 3;
const WAITER_STILL = 0.5;
const WAITER_PASSED = 2;
const WAITER_GONE = 30;
const PLAYER_KEY = -1;
const HIT_MARGIN = 0.3;
const HIT_SPEED = 1;
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

/** A stopped or creeping car over a crosswalk is not hitting anyone; crossers wait for it instead. */
export function canHitPedestrian(speed: number): boolean {
  return Math.abs(speed) > HIT_SPEED;
}

/** Whether segment a-b passes through the player's box grown by `margin`. */
function segmentHitsBox(a: Vec2, b: Vec2, player: PlayerState, margin: number): boolean {
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  const local = (p: Vec2): Vec2 => {
    const dx = p[0] - player.position[0], dz = p[1] - player.position[1];
    return [dx * fx + dz * fz, dx * fz - dz * fx];
  };
  const p0 = local(a), p1 = local(b);
  const half: Vec2 = [player.length / 2 + margin, player.width / 2 + margin];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 2; k++) {
    const d = p1[k] - p0[k];
    for (const [num, den] of [[half[k] - p0[k], d], [half[k] + p0[k], -d]]) {
      if (den === 0) {
        if (num < 0) return false;
      } else if (den > 0) {
        t1 = Math.min(t1, num / den);
      } else {
        t0 = Math.max(t0, num / den);
      }
    }
  }
  return t0 <= t1;
}

const cellKey = (cx: number, cz: number) => `${cx},${cz}`;

/** Distance from p to segment a-b. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2, 0), 1) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}

/** The car roads whose carriageway (grown by ROAD_MARGIN) covers a point. */
function carriagewayTest(d: DistrictData): (p: Vec2) => string[] {
  const grid = new Map<string, { a: Vec2; b: Vec2; reach: number; road: string }[]>();
  for (const r of d.roads) {
    if (FOOT_KINDS.has(r.kind)) continue;
    const reach = r.width / 2 + ROAD_MARGIN;
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i];
      const seg = { a, b, reach, road: r.id };
      const x0 = Math.floor((Math.min(a[0], b[0]) - reach) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + reach) / CELL);
      const z0 = Math.floor((Math.min(a[1], b[1]) - reach) / CELL), z1 = Math.floor((Math.max(a[1], b[1]) + reach) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = cellKey(cx, cz);
          const list = grid.get(k);
          if (list) list.push(seg);
          else grid.set(k, [seg]);
        }
      }
    }
  }
  return (p: Vec2) => [...new Set(
    (grid.get(cellKey(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL))) ?? []).filter(s => segDist(p, s.a, s.b) < s.reach).map(s => s.road),
  )];
}

/** Footway polylines cut into runs that stay off every car carriageway. */
function offRoadRuns(d: DistrictData, onRoad: (p: Vec2) => boolean): Footway[] {
  const runs: Footway[] = [];
  for (const r of d.roads) {
    if (!FOOT_KINDS.has(r.kind) || r.points.length < 2) continue;
    let run: Vec2[] = [];
    const flush = () => {
      if (run.length > 1 && polyLength(run) >= MIN_RUN) runs.push({ points: run, length: polyLength(run) });
      run = [];
    };
    const visit = (p: Vec2) => (onRoad(p) ? flush() : run.push(p));
    visit(r.points[0]);
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i];
      const n = Math.max(1, Math.ceil(dist(a, b) / SAMPLE_STEP));
      for (let k = 1; k <= n; k++) visit([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    flush();
  }
  return runs;
}

export class PedSim implements CrossingOccupancy {
  private readonly pool: Ped[] = [];
  readonly peds: readonly PedView[] = this.pool;
  private readonly rand: () => number;
  private readonly crossings: CrossingGeom[] = [];
  private readonly crossingIndex = new Map<string, number>();
  private readonly footways: Footway[] = [];
  private readonly footwayCells = new Map<string, number[]>();
  /** Walker spawn samples taken during the last step. */
  spawnAttempts = 0;
  private readonly clear = new Map<number, boolean>();
  private readonly standing = new Map<number, Map<number, number>>();
  /** Unsignalled crossing index to the car new crossers wait for. */
  private readonly yieldTo = new Map<number, number>();
  private readonly roadsAt: (p: Vec2) => string[];

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
        id: c.id, road: edge.roadId, kind: c.kind, centre: c.position, tangent,
        normal: [-tangent[1], tangent[0]], half: c.width / 2 + CURB_MARGIN,
      });
    }
    this.roadsAt = carriagewayTest(d);
    this.footways.push(...offRoadRuns(d, p => this.roadsAt(p).length > 0));
    this.footways.forEach((f, k) => {
      const xs = f.points.map(p => Math.floor(p[0] / CELL)), zs = f.points.map(p => Math.floor(p[1] / CELL));
      for (let cx = Math.min(...xs); cx <= Math.max(...xs); cx++) {
        for (let cz = Math.min(...zs); cz <= Math.max(...zs); cz++) {
          const key = cellKey(cx, cz);
          const list = this.footwayCells.get(key);
          if (list) list.push(k);
          else this.footwayCells.set(key, [k]);
        }
      }
    });
    const total = opts.crossers + opts.walkers;
    for (let i = 0; i < total; i++) {
      this.pool.push({
        id: i, active: false, position: [0, 0], heading: 0, colour: COLOURS[0], walking: false,
        kind: i < opts.crossers ? 'crosser' : 'walker', speed: 0,
        crossing: 0, across: 0, along: 0, state: 'waiting', dir: 1, leaveDir: 1, left: 0, leavePath: [], leaveLength: 0, footway: 0, s: 0,
      });
    }
  }

  step(dt: number, player: PlayerState, cars: readonly AgentView[], signals: SignalSystem): void {
    this.clear.clear();
    this.watchWaiters(dt, player, cars);
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

  /** A crosser stands at the curb of this crossing, about to step out. */
  curbWaiting(crossingId: string): boolean {
    const k = this.crossingIndex.get(crossingId);
    return k !== undefined && this.pool.some(p => p.active && p.kind === 'crosser' && p.crossing === k && p.state === 'waiting');
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

  /** Removes every pedestrian within `radius` of `position`, for placing the player there. */
  clearNear(position: Vec2, radius: number): void {
    for (const p of this.pool) if (p.active && dist(p.position, position) < radius) p.active = false;
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
    if (p.state !== 'leaving') {
      const far: Vec2 = [
        x.centre[0] + x.normal[0] * p.dir * x.half + x.tangent[0] * p.along,
        x.centre[1] + x.normal[1] * p.dir * x.half + x.tangent[1] * p.along,
      ];
      if (segmentHitsBox(p.position, far, player, HIT_MARGIN)) {
        p.walking = false;
        return;
      }
    }
    if (p.state === 'waiting') {
      if (!this.mayCross(p.crossing, player, cars, signals)) return;
      p.state = 'crossing';
    }
    if (p.state === 'crossing') {
      p.walking = true;
      p.across += p.dir * p.speed * dt;
      if (p.dir * (p.across - p.dir * x.half) >= 0) {
        p.across = p.dir * x.half;
        p.state = 'leaving';
        this.planLeave(p, x);
      }
    } else {
      p.left += p.speed * dt;
      if (p.left >= p.leaveLength) {
        p.active = false;
        return;
      }
    }
    this.placeCrosser(p, x);
  }

  /**
   * Out from the kerb until off every carriageway, then along the pavement the chosen way for as long as that stays
   * off the roads too. Near a junction the pavement line would otherwise lead straight across the other road.
   */
  private planLeave(p: Ped, x: CrossingGeom): void {
    const at = (across: number, along: number): Vec2 => [
      x.centre[0] + x.normal[0] * across + x.tangent[0] * along,
      x.centre[1] + x.normal[1] * across + x.tangent[1] * along,
    ];
    // Stepping off the crossing road is fine; a kerb end that lies on another road, or no way off within
    // LEAVE_OUT_MAX, means there is no pavement here, and the crosser simply goes.
    let out = 0;
    for (;;) {
      const roads = this.roadsAt(at(p.across + p.dir * out, p.along));
      if (!roads.length) break;
      if (out >= LEAVE_OUT_MAX || roads.some(r => r !== x.road)) {
        p.leavePath = [at(p.across, p.along)];
        p.leaveLength = 0;
        p.left = 0;
        return;
      }
      out += LEAVE_SAMPLE;
    }
    const across = p.across + p.dir * out;
    const clear = (dir: 1 | -1) => {
      let run = 0;
      while (run < LEAVE_DISTANCE && !this.roadsAt(at(across, p.along + dir * (run + LEAVE_SAMPLE))).length) run += LEAVE_SAMPLE;
      return run;
    };
    const back = -p.leaveDir as 1 | -1;
    let run = clear(p.leaveDir);
    const other = clear(back);
    if (other > run) [p.leaveDir, run] = [back, other];
    p.leavePath = [at(p.across, p.along)];
    if (out > 0) p.leavePath.push(at(across, p.along));
    if (run > 0) p.leavePath.push(at(across, p.along + p.leaveDir * run));
    p.leaveLength = polyLength(p.leavePath);
    p.left = 0;
  }

  private placeCrosser(p: Ped, x: CrossingGeom): void {
    if (p.state === 'leaving' && p.leavePath.length > 1) {
      const at = pointAlong(p.leavePath, Math.min(p.left, p.leaveLength));
      p.position[0] = at.x;
      p.position[1] = at.z;
      p.heading = at.heading;
      return;
    }
    p.position[0] = x.centre[0] + x.normal[0] * p.across + x.tangent[0] * p.along;
    p.position[1] = x.centre[1] + x.normal[1] * p.across + x.tangent[1] * p.along;
    p.heading = Math.atan2(x.normal[0] * p.dir, x.normal[1] * p.dir);
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
      ok = !this.yieldTo.has(k) && !cars.some(c => c.active && blocked(c)) && (x.kind === 'zebra' || !blocked(player));
    }
    this.clear.set(k, ok);
    return ok;
  }

  private watchWaiters(dt: number, player: PlayerState, cars: readonly AgentView[]): void {
    const along = (x: CrossingGeom, c: { position: Vec2; heading: number }) =>
      (x.centre[0] - c.position[0]) * Math.sin(c.heading) + (x.centre[1] - c.position[1]) * Math.cos(c.heading);
    const kerbs = (x: CrossingGeom): [Vec2, Vec2] => [
      [x.centre[0] - x.normal[0] * x.half, x.centre[1] - x.normal[1] * x.half],
      [x.centre[0] + x.normal[0] * x.half, x.centre[1] + x.normal[1] * x.half],
    ];
    const all = [...cars.filter(c => c.active).map(c => ({ key: c.id, c, half: CAR_CLASSES[c.carClass].length / 2 })),
      { key: PLAYER_KEY, c: player, half: player.length / 2 }];
    for (const [k, key] of this.yieldTo) {
      const x = this.crossings[k], v = all.find(e => e.key === key);
      if (!v || along(x, v.c) < -(v.half + WAITER_PASSED) || segDist(v.c.position, ...kerbs(x)) > WAITER_GONE) this.yieldTo.delete(k);
    }
    const watched = new Set<number>();
    for (const p of this.pool) if (p.active && p.kind === 'crosser' && this.crossings[p.crossing].kind !== 'signal') watched.add(p.crossing);
    for (const k of this.standing.keys()) if (!watched.has(k) || this.yieldTo.has(k)) this.standing.delete(k);
    for (const k of watched) {
      if (this.yieldTo.has(k)) continue;
      const x = this.crossings[k], [ka, kb] = kerbs(x), times = this.standing.get(k) ?? new Map<number, number>();
      this.standing.set(k, times);
      for (const { key, c, half } of all) {
        const front: Vec2 = [c.position[0] + Math.sin(c.heading) * half, c.position[1] + Math.cos(c.heading) * half];
        if (Math.abs(c.speed) >= WAITER_STILL || dist(c.position, x.centre) > x.half + half + WAITER_REACH
          || along(x, c) <= 0 || segDist(front, ka, kb) > WAITER_REACH) {
          times.delete(key);
          continue;
        }
        const t = (times.get(key) ?? 0) + dt;
        times.set(key, t);
        if (t >= WAITER_STARVED) this.yieldTo.set(k, key);
      }
    }
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
    let runs: number[] | null = null;
    this.spawnAttempts = 0;
    for (const p of this.pool) {
      if (p.active) continue;
      if (p.kind === 'crosser') {
        near ??= this.crossings.flatMap((x, k) => {
          const d = dist(x.centre, player.position);
          return d >= MIN_SPAWN_DIST && d <= CROSSER_RANGE ? [k] : [];
        });
        if (near.length) this.spawnCrosser(p, near);
      } else {
        runs ??= this.runsNear(player);
        if (runs.length && this.spawnAttempts < WALKER_ATTEMPTS_PER_STEP) this.spawnWalker(p, runs, player);
      }
    }
  }

  private spawnCrosser(p: Ped, near: number[]): void {
    const k = near[Math.floor(this.rand() * near.length)];
    const x = this.crossings[k];
    const side: 1 | -1 = this.rand() < 0.5 ? -1 : 1;
    p.crossing = k;
    p.across = side * x.half;
    p.along = (this.rand() * 2 - 1) * SPAWN_JITTER;
    p.dir = side === 1 ? -1 : 1;
    p.leaveDir = this.rand() < 0.5 ? -1 : 1;
    p.left = 0;
    p.state = 'waiting';
    p.walking = false;
    p.speed = CROSS_SPEED[0] + this.rand() * (CROSS_SPEED[1] - CROSS_SPEED[0]);
    this.activate(p);
    this.placeCrosser(p, x);
  }

  private runsNear(player: PlayerState): number[] {
    const found = new Set<number>();
    const [px, pz] = player.position;
    for (let cx = Math.floor((px - WALKER_RANGE) / CELL); cx <= Math.floor((px + WALKER_RANGE) / CELL); cx++) {
      for (let cz = Math.floor((pz - WALKER_RANGE) / CELL); cz <= Math.floor((pz + WALKER_RANGE) / CELL); cz++) {
        for (const k of this.footwayCells.get(cellKey(cx, cz)) ?? []) found.add(k);
      }
    }
    return [...found];
  }

  private spawnWalker(p: Ped, runs: number[], player: PlayerState): void {
    const total = runs.reduce((sum, k) => sum + this.footways[k].length, 0);
    for (let i = 0; i < SPAWN_ATTEMPTS && this.spawnAttempts < WALKER_ATTEMPTS_PER_STEP; i++) {
      this.spawnAttempts++;
      let pick = this.rand() * total;
      let n = 0;
      while (n < runs.length - 1 && pick > this.footways[runs[n]].length) pick -= this.footways[runs[n++]].length;
      const k = runs[n];
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
