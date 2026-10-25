import { readFileSync } from 'node:fs';
import type { DistrictData, Vec2 } from '../shared/district';
import { CODE } from '../shared/signCatalogue';
import type { GameEvent } from '../sim/events';
import { SignalSystem, type LightState } from '../sim/signals';
import { SignSystem } from '../sim/signs';
import { canHitPedestrian, PedSim } from '../peds/pedSim';
import { canStopBefore, idmAccel, turnSpeed } from '../traffic/idm';
import { LaneNetwork, pointAt, type LaneRef } from '../traffic/lanes';
import { approachSpeeds, closingSpeed } from '../traffic/trafficBodies';
import { CAR_CLASSES, TrafficSim, type PlayerState } from '../traffic/trafficSim';
import { endHeading, project, startHeading, turnBetween, wrapAngle } from '../traffic/turns';
import { newCabin, stepCabin, type CabinState, type Indicator } from '../vehicle/cabin';
import type { Controls, Glance } from '../vehicle/drivetrain';
import type { ExamResult, Prompt } from './examiner';
import { MapMatcher } from './mapMatch';
import { loadPenalties } from './penalties';
import type { ExamRoute } from './route';
import { RuleEngine } from './rules/engine';
import { RoadInfo } from './rules/road';
import { IndicatorRule, PullOffRule } from './rules/signalling';
import type { Violation } from './rules/types';
import { CROSSING_HALF_DEPTH, FRONT_OFFSET, STOP_SPEED, YELLOW_MAX_DECEL } from './rules/thresholds';
import { buildSnapshot, type DriveSnapshot } from './snapshot';
import { ExamSession, type SessionFrame } from './session';

/**
 * Kinematic scripted drivers for the headless exam runs. The car follows the planned lanes and connectors exactly;
 * only its speed is decided, from IDM against the car ahead plus comfortable stops for lights, crossings, stop signs,
 * priority and the finish. What is under test is the rules, the examiner and the traffic, not vehicle handling.
 */

export interface DriverStyle {
  /** Uses the indicator for the pull-off, every turn and every lane change. */
  indicators: boolean;
  /** Stops for red and stoppable yellow lights. */
  obeyLights: boolean;
}

export interface DriverWorld {
  d: DistrictData;
  net: LaneNetwork;
  signals: SignalSystem;
  signs: SignSystem;
  traffic: TrafficSim;
  peds: PedSim;
  route: ExamRoute;
}

export const PLAYER_LENGTH = 4.48;
export const PLAYER_WIDTH = 1.74;

const COMFORT_DECEL = 2.5;
const MAX_DECEL = 4.5;
const MAX_ACCEL = 1.5;
/** Fraction of the posted limit the driver cruises at. */
const CRUISE = 0.9;
const LOOKAHEAD = 80;
const STOP_GAP = 1;
/** A car within this of the planned path, centre to centre, is in the way. */
const PATH_HALF_WIDTH = 2;
const SIGNAL_REACH = 40;
const YIELD_MARGIN_TTA = 6;
const YIELD_MOVING = 0.3;
const SIGNAL_LEAD_TIME = 3;
const SIGNAL_LEAD_MIN = 25;
const GLANCE_EVERY = 2;
const LANE_CHANGE_LENGTH = 25;
const LANE_CHANGE_GAP = 15;
const PULL_OFF_WAIT = 2;
const PULL_OFF_CANCEL = 10;
const STOP_SIGN_HOLD = 1.2;
const CURB_RELEASE = 1.2;
const PED_CLEARANCE = 1;
const SHORT_LANE = 8;
const WAITING_AT_LINE = 8;
const YIELD_PATIENCE = 8;
const CRAWL = 2;
/** A car ahead slower than this may stop before the player has cleared a crossing behind it. */
const QUEUE_SPEED = 3;
const BUSY_TTA = 4;
/** Patience with a car standing at its line counts only while the player waits this close to its own line. */
const WAIT_NEAR_LINE = 3;
/** Inside the junction a left turner may still wait until its heading has turned this far, short of the rule's commit. */
const LEFT_WAIT_ANGLE = (38 * Math.PI) / 180;
/** Crossings drawn across the junction mouth sit past the lane end but still on its edge. */
const JUNCTION_CROSSING = 15;
const LANE_GAP_BEHIND = 12;
const LANE_GAP_AHEAD = 10;
const LANE_GAP_TIME = 3;
const CUT_STEP = 0.25;
const CUT_HORIZON = 2.5;
const CUT_MARGIN = 0.5;
/** Standing this long nose to nose with a car that waits for us, back off this far at this speed to clear its path. */
const BACK_OFF_AFTER = 3;
const BACK_OFF_DISTANCE = 2.5;
const BACK_OFF_SPEED = 0.8;
/** Cobalt wheelbase, and MAX_STEER and STEER_FALLOFF_SPEED in src/vehicle/vehicle.ts, to turn path curvature into steer input. */
const WHEELBASE = 2.6;
const MAX_STEER = 0.6;
const STEER_FALLOFF_SPEED = 12;
/** STEER_IN and STEER_OUT in src/vehicle/input.ts: keyboard steer ramps, per second. */
const KEY_STEER_IN = 3;
const KEY_STEER_OUT = 5;
/** Steer-seconds of error the keyboard driver lets build up before tapping a key. */
const KEY_TAP = 0.03;

interface Piece {
  kind: 'lane' | 'conn';
  step: number;
  /** Lane pieces only: the lane driven on at the start and at the end of the piece. */
  ref: LaneRef;
  endRef: LaneRef;
  s0: number;
  s1: number;
  /** Lane path distance of the lane at s0. */
  path0: number;
}

interface Signalling {
  side: Indicator;
  /** Polyline distance where the maneuver starts (junction entry or the start of the lane change). */
  at: number;
  /** Polyline distance after which the indicator goes off. */
  until: number;
  /** Lane changes only: the lane being moved into. */
  into?: LaneRef;
}

export interface DriverLog {
  t: number;
  what: string;
}

class Polyline {
  readonly pts: Vec2[] = [];
  readonly cum: number[] = [];

  push(p: Vec2): void {
    const n = this.pts.length;
    if (n) {
      const q = this.pts[n - 1];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < 1e-3) return;
      this.cum.push(this.cum[n - 1] + d);
    } else this.cum.push(0);
    this.pts.push(p);
  }

  get length(): number {
    return this.cum[this.cum.length - 1] ?? 0;
  }

  private seg(s: number): number {
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  at(s: number): { position: Vec2; heading: number } {
    const c = Math.min(Math.max(s, 0), this.length);
    const i = Math.min(this.seg(c), this.pts.length - 2);
    const a = this.pts[i], b = this.pts[i + 1];
    const len = this.cum[i + 1] - this.cum[i] || 1;
    const t = (c - this.cum[i]) / len;
    return { position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }

  /** Nearest point of the stretch [from, to] to `p`: distance along and lateral offset. */
  project(p: Vec2, from: number, to: number): { s: number; lateral: number; heading: number } | null {
    let best: { s: number; lateral: number; heading: number } | null = null;
    const i0 = this.seg(Math.max(0, from)), i1 = Math.min(this.seg(Math.min(this.length, to)) + 1, this.pts.length - 1);
    for (let i = i0; i < i1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
      const lateral = Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
      const s = this.cum[i] + t * Math.sqrt(len2);
      if (s < from || s > to) continue;
      if (!best || lateral < best.lateral) best = { s, lateral, heading: Math.atan2(dx, dz) };
    }
    return best;
  }
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a: Vec2, b: Vec2, w: number): Vec2 => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];

/** Rectangles overlap (separating axis test on both boxes' axes). */
function boxesOverlap(a: { p: Vec2; h: number; l: number; w: number }, b: { p: Vec2; h: number; l: number; w: number }): boolean {
  const axes = [a.h, a.h + Math.PI / 2, b.h, b.h + Math.PI / 2];
  const dx = b.p[0] - a.p[0], dz = b.p[1] - a.p[1];
  const extent = (box: typeof a, ax: number, az: number) =>
    (box.l / 2) * Math.abs(Math.sin(box.h) * ax + Math.cos(box.h) * az) + (box.w / 2) * Math.abs(Math.cos(box.h) * ax - Math.sin(box.h) * az);
  return axes.every(h => {
    const ax = Math.sin(h), az = Math.cos(h);
    return Math.abs(dx * ax + dz * az) <= extent(a, ax, az) + extent(b, ax, az);
  });
}

export class ScriptedDriver {
  readonly line = new Polyline();
  readonly pieces: Piece[] = [];
  readonly log: DriverLog[] = [];
  /** Turn and lane-change maneuvers this plan signals for, in order. */
  readonly signalling: Signalling[] = [];
  readonly laneChanges: number;
  /** Times the driver backed off for a car waiting for it. */
  backOffs = 0;
  s = 0;
  v = 0;
  cabin: CabinState = { ...newCabin(), belt: true };
  private prevV = 0;
  private finishS: number;
  private readonly road: RoadInfo;
  private readonly matcher: MapMatcher;
  private snap: DriveSnapshot | null = null;
  private readonly yellow = new Map<string, boolean>();
  private readonly alongCache = new Map<string, number>();
  /** Per step: conflicts at each approach's junction. */
  private readonly conflictCache = new Map<string, DriveSnapshot['junctionConflicts']>();
  private readonly edgePts = new Map<string, Vec2[]>();
  private readonly curbStill = new Map<string, number>();
  private readonly stopSignDone = new Set<number>();
  private stopSignStill = 0;
  private yieldWait = 0;
  private stillAtStart = 0;
  /** The car the last decision stopped for, and backing off from one that waits for us. */
  private blocker: number | null = null;
  private heldFor = 0;
  private backingFrom: number | null = null;
  private readonly backedOff = new Set<string>();
  private moved = false;
  private lastGlance = -Infinity;
  private touching = new Set<number>();
  /** Keyboard steer: the ramped input, the key held, and the error built up since the last tap. */
  private steer = 0;
  private steerKey = 0;
  private steerDebt = 0;
  private wantSignal: Indicator | null = null;
  private readonly signalledApproach: boolean[];
  private readonly steps: LaneRef[];

  constructor(private readonly w: DriverWorld, private readonly style: DriverStyle) {
    this.road = new RoadInfo(w.d, w.net, w.signs);
    this.matcher = new MapMatcher(w.d, w.net);
    const { net, route } = w;
    const n = route.steps.length;

    const { entry, exit } = this.planLanes();
    this.steps = route.steps.map((st, i) => ({ ...st.ref, lane: exit[i] }));

    let changes = 0;
    for (let i = 0; i < n; i++) {
      const base = route.steps[i].ref;
      const a = entry[i], b = exit[i];
      const lane = (k: number) => net.path({ ...base, lane: k });
      const first = lane(a);
      const path0 = i === 0 ? project(first.points, route.start.position) : 0;
      const pathEnd = first.length;
      const s0 = this.line.length;
      const hops = Math.abs(b - a);
      const sign = Math.sign(b - a);
      // Lane changes run after any stop line near the lane start and finish well before the lane end.
      const span = hops * LANE_CHANGE_LENGTH + Math.max(0, hops - 1) * LANE_CHANGE_GAP;
      const startChange = Math.max(path0 + 10, Math.min(pathEnd - span - 60, 80));
      if (hops && startChange + span > pathEnd - 20) throw new Error(`no room to change lanes on step ${i}`);
      const laneAt = (u: number) => {
        if (!hops) return a;
        let x = a;
        for (let h = 0; h < hops; h++) {
          const c0 = startChange + h * (LANE_CHANGE_LENGTH + LANE_CHANGE_GAP);
          x += sign * smooth((u - c0) / LANE_CHANGE_LENGTH);
        }
        return x;
      };
      for (let u = path0; ; u = Math.min(u + 1, pathEnd)) {
        const x = laneAt(u);
        const lo = Math.floor(x + 1e-9), frac = x - lo;
        const pa = pointAt(lane(lo).points, u * (lane(lo).length / first.length)).position;
        const pb = frac > 1e-6 ? pointAt(lane(lo + 1).points, u * (lane(lo + 1).length / first.length)).position : pa;
        this.line.push(lerp(pa, pb, frac));
        if (u >= pathEnd) break;
      }
      for (let h = 0; h < hops; h++) {
        const c0 = startChange + h * (LANE_CHANGE_LENGTH + LANE_CHANGE_GAP);
        this.signalling.push({
          side: sign > 0 ? 'left' : 'right', at: s0 + (c0 - path0), until: s0 + (c0 + LANE_CHANGE_LENGTH - path0) + 2, into: { ...base, lane: a + sign * (h + 1) },
        });
        changes++;
      }
      this.pieces.push({ kind: 'lane', step: i, ref: { ...base, lane: a }, endRef: { ...base, lane: b }, s0, s1: this.line.length, path0 });
      if (i === n - 1) break;
      const from = this.steps[i], to: LaneRef = { ...route.steps[i + 1].ref, lane: entry[i + 1] };
      const c0 = this.line.length;
      for (const p of net.connector(from, to)) this.line.push(p);
      this.pieces.push({ kind: 'conn', step: i, ref: from, endRef: to, s0: c0, s1: this.line.length, path0: 0 });
      const turn = turnBetween(net, from, to);
      if (turn !== 'straight') {
        this.signalling.push({ side: turn === 'right' ? 'right' : 'left', at: c0, until: this.line.length + 5 });
      }
    }
    this.signalling.sort((x, y) => x.at - y.at);
    this.laneChanges = changes;
    const last = this.pieces[this.pieces.length - 1];
    const lastPath = net.path(last.ref).points;
    this.finishS = last.s0 + project(lastPath, route.finish.position);
    this.s = this.pieces[0].s0;
    this.signalledApproach = route.steps.map(st => {
      const p = net.path(st.ref);
      const light = w.signals.approachState(st.ref.edgeId, st.ref.dir, p.endAt - SIGNAL_REACH * st.ref.dir, [p.startAt, p.endAt]);
      return !!light && Math.abs(light.stopAt - p.endAt) <= SIGNAL_REACH;
    });
  }

  /**
   * Lane per step: rightmost by default, the outer lane before a turn, and at a fork the lanes that lead on to the
   * route's branch. A lane change too long for its lane is made through the junction before it instead.
   */
  private planLanes(): { entry: number[]; exit: number[] } {
    const { net, route, d } = this.w;
    const n = route.steps.length;
    const edges = new Map(d.graph.edges.map(e => [e.id, e]));
    const laneRefs = (r: LaneRef) => Array.from({ length: this.road.lanes(r) }, (_, k) => ({ ...r, lane: k }));
    const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const lastPt = (r: LaneRef) => net.path(r).points[net.path(r).points.length - 1];
    const firstPt = (r: LaneRef) => net.path(r).points[0];
    const entry: number[] = [], exit: number[] = [];
    for (let i = 0; i < n; i++) {
      const ref = route.steps[i].ref;
      const lanes = this.road.lanes(ref);
      let enter = i === 0 ? 0 : entry[i];
      const m = route.steps[i].maneuver;
      let want: number;
      if (m === 'left' || m === 'uturn') want = lanes - 1;
      else if (m === 'right') want = 0;
      else if (i === n - 1) want = enter;
      else {
        const next = route.steps[i + 1].ref;
        const h = startHeading(net.path(next).points);
        const rivals = net.exits(ref).filter(r => r.edgeId !== next.edgeId && edges.has(r.edgeId)
          && Math.abs(wrapAngle(startHeading(net.path(r).points) - h)) < Math.PI / 6);
        const natural = laneRefs(ref).filter(l => {
          const p = lastPt(l);
          const mine = Math.min(...laneRefs(next).map(k => dist(p, firstPt(k))));
          return rivals.every(r => laneRefs(r).every(k => dist(p, firstPt(k)) > mine));
        }).map(l => l.lane);
        want = natural.length ? natural.reduce((b, k) => (Math.abs(k - enter) < Math.abs(b - enter) ? k : b)) : enter;
      }
      const path0 = i === 0 ? project(net.path({ ...ref, lane: enter }).points, route.start.position) : 0;
      const span = Math.abs(want - enter) * (LANE_CHANGE_LENGTH + LANE_CHANGE_GAP);
      // A one-lane shift between roads of different lane widths is taken through the junction, as is any change the lane is too short for.
      if (i > 0 && want !== enter && (Math.abs(want - enter) === 1 || path0 + 30 + span > net.path(ref).length)) enter = want;
      entry[i] = enter;
      exit[i] = want;
      if (i < n - 1) {
        // The lane index carries over as it does for AI cars, so both use the same connectors through a junction.
        entry[i + 1] = Math.min(want, this.road.lanes(route.steps[i + 1].ref) - 1);
      }
    }
    return { entry, exit };
  }

  get pose(): { position: Vec2; heading: number } {
    return this.line.at(this.s);
  }

  player(): PlayerState {
    const { position, heading } = this.pose;
    return { position, heading, speed: this.v, length: PLAYER_LENGTH, width: PLAYER_WIDTH };
  }

  get finished(): boolean {
    return this.s >= this.finishS - 15;
  }

  /** Puts the car at the route start, at rest. */
  place(): void {
    this.s = this.pieces[0].s0;
    this.v = this.prevV = 0;
    this.cabin = { ...newCabin(), belt: true };
    this.steer = this.steerKey = this.steerDebt = 0;
    this.wantSignal = null;
    this.moved = false;
    this.stillAtStart = 0;
  }

  /** One fixed step: decide the acceleration from the world as it is now, move, and report the frame. */
  step(t: number, dt: number): SessionFrame {
    const a = this.decide(t, dt);
    this.prevV = this.v;
    if (this.backOff(dt)) this.v = -BACK_OFF_SPEED;
    else {
      this.v = Math.max(0, this.v + a * dt);
      if (this.v < 0.02 && a <= 0) this.v = 0;
    }
    this.s = Math.min(Math.max(this.s + this.v * dt, 0), this.line.length);
    if (this.v > STOP_SPEED) this.moved = true;
    this.keyboardSteer(dt);
    this.signal(t);
    const { position, heading } = this.pose;
    const events = this.contacts(t);
    const frame: SessionFrame = {
      t, dt, position, heading, speed: this.v,
      drivetrain: { gearbox: 'auto', gear: this.v < 0 ? -1 : 1, rpm: 800, running: true },
      cabin: this.cabin, steer: this.steer, events,
    };
    this.snap = buildSnapshot(
      { d: this.w.d, net: this.w.net, matcher: this.matcher, signals: this.w.signals, signs: this.w.signs, peds: this.w.peds, traffic: this.w.traffic, playerLength: PLAYER_LENGTH },
      { ...frame, prevSpeed: this.prevV },
    );
    return frame;
  }

  /** The snapshot the driver last saw, built by its own matcher from the frame it reported. */
  get snapshot(): DriveSnapshot | null {
    return this.snap;
  }

  private piece(s: number): Piece {
    let lo = 0, hi = this.pieces.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.pieces[mid].s0 <= s) lo = mid;
      else hi = mid - 1;
    }
    return this.pieces[lo];
  }

  private note(t: number, what: string): void {
    const last = this.log[this.log.length - 1];
    if (last?.what !== what) this.log.push({ t, what });
  }

  private decide(t: number, dt: number): number {
    this.conflictCache.clear();
    const front = this.s + FRONT_OFFSET;
    const v = this.v;
    let acc = MAX_ACCEL;
    let why = 'cruise';
    let by: number | null = null;
    const limit = (a: number, reason: string, car: number | null = null) => {
      if (a < acc) {
        acc = a;
        why = reason;
        by = car;
      }
    };
    /** A point the front must not pass, with the speed it may have there. */
    const target = (gap: number, vMax: number, reason: string, car: number | null = null) => {
      const g = Math.max(gap, 0.01);
      if (vMax === 0 && g < 0.3) return limit(-v / dt, reason, car);
      const allowed = Math.sqrt(vMax * vMax + 2 * COMFORT_DECEL * g);
      if (v > allowed) limit(-Math.min(MAX_DECEL, Math.max(COMFORT_DECEL, (v * v - vMax * vMax) / (2 * g))), reason, car);
      else limit(Math.min(MAX_ACCEL, (allowed - v) / 0.5), reason, car);
    };

    // Pull-off: indicate and wait before moving.
    if (!this.moved) {
      this.stillAtStart += dt;
      if (this.stillAtStart < PULL_OFF_WAIT) return 0;
    }

    // Speed: the limit here and any lower one or a turn ahead.
    const here = this.piece(this.s);
    let cruise = this.limitAt(here, this.s) / 3.6 * CRUISE;
    for (const p of this.pieces) {
      if (p.s1 < this.s || p.s0 > this.s + LOOKAHEAD) continue;
      if (p.kind === 'conn') {
        const from = this.w.net.path(p.ref).points, to = this.w.net.path(p.endRef).points;
        const vTurn = turnSpeed(wrapAngle(startHeading(to) - endHeading(from)));
        if (vTurn < Infinity) {
          if (p.s0 <= front) cruise = Math.min(cruise, vTurn);
          else target(p.s0 - front, vTurn, 'turn');
        }
      } else if (p.s0 > this.s) {
        const vl = (this.limitAt(p, p.s0) / 3.6) * CRUISE;
        if (vl < cruise) target(p.s0 - front, vl, 'limit ahead');
      }
    }

    // Car ahead on the planned path.
    const lead = this.leader();
    if (lead) {
      const a = idmAccel(v, lead.gap, lead.speed, { v0: Math.max(cruise, 0.1), a: MAX_ACCEL, b: 2, T: 1.4, s0: 2.5 });
      limit(Math.max(-MAX_DECEL, a), `leader ${lead.id}`, lead.id);
    } else limit(MAX_ACCEL * (1 - (v / Math.max(cruise, 0.1)) ** 4), 'cruise');

    for (const p of this.pieces) {
      if (p.s1 < this.s - 10 || p.s0 > front + LOOKAHEAD) continue;
      if (p.kind !== 'lane') continue;
      this.lights(p, front, v, target);
      this.crossings(p, front, v, dt, target);
      this.junction(p, front, dt, target);
    }

    // Anyone standing or walking on the path.
    for (const q of this.w.peds.peds) {
      if (!q.active || Math.abs(q.position[0] - this.pose.position[0]) > 30 || Math.abs(q.position[1] - this.pose.position[1]) > 30) continue;
      const hit = this.line.project(q.position, this.s - PLAYER_LENGTH / 2 - 0.5, front + 20);
      if (hit && hit.lateral < PLAYER_WIDTH / 2 + PED_CLEARANCE) target(hit.s - front - STOP_GAP, 0, `pedestrian ${q.id} in the way`);
    }

    const cut = this.cutIn();
    if (cut) target(cut.gap, 0, `car ${cut.id} cutting across`, cut.id);

    const hop = this.signalling.find(m => m.into && m.at > this.s);
    if (hop && hop.at - this.s < LOOKAHEAD && !this.gapFree(hop.into!)) target(hop.at - this.s, 0, `gap in lane ${hop.into!.lane}`);

    target(this.finishS - this.s, 0, 'finish');
    this.blocker = by;
    this.note(t, why);
    return acc;
  }

  /**
   * A car that waits because we stand in its path while we wait for it never moves first. A driver backs off a
   * little, once per car, so its path is clear; it is not a forward gear, so it is no roll-back.
   */
  private backOff(dt: number): boolean {
    const b = this.blocker === null ? null : this.w.traffic.agents[this.blocker];
    const x = b?.active && b.speed < YIELD_MOVING ? this.w.traffic.inspect(b.id) : null;
    const key = x ? `${b!.id}:${x.generation}` : '';
    if (this.backingFrom === null) {
      this.heldFor = x?.heldByPlayer && this.v === 0 && !this.backedOff.has(key) ? this.heldFor + dt : 0;
      if (this.heldFor < BACK_OFF_AFTER) return false;
      this.backedOff.add(key);
      this.backOffs++;
      this.backingFrom = this.s;
      this.heldFor = 0;
    }
    if (this.backingFrom - this.s < BACK_OFF_DISTANCE && this.s > 0 && !this.carBehind()) return true;
    this.backingFrom = null;
    this.v = 0;
    return false;
  }

  private carBehind(): boolean {
    const at = this.line.at(this.s - 1);
    const mine = { p: at.position, h: at.heading, l: PLAYER_LENGTH, w: PLAYER_WIDTH };
    return this.w.traffic.agents.some(a => {
      if (!a.active || Math.abs(a.position[0] - at.position[0]) > 15 || Math.abs(a.position[1] - at.position[1]) > 15) return false;
      const k = CAR_CLASSES[a.carClass];
      return boxesOverlap(mine, { p: a.position, h: a.heading, l: k.length, w: k.width });
    });
  }

  private limitAt(p: Piece, s: number): number {
    return this.w.signs.speedLimitAt(p.ref.edgeId, p.ref.dir, this.edgeAt(p, Math.max(s, p.s0))) || 60;
  }

  /** Edge centreline distance of a point on the polyline, as the matcher measures it. */
  private edgeAt(p: Piece, s: number): number {
    return project(this.edgePoints(p.ref.edgeId), this.line.at(s).position);
  }

  /** Polyline distance level with an edge centreline position on a lane piece. */
  private along(p: Piece, edgeS: number): number {
    const key = `${p.s0}|${edgeS.toFixed(2)}`;
    let at = this.alongCache.get(key);
    if (at === undefined) {
      const pt = pointAt(this.edgePoints(p.ref.edgeId), edgeS).position;
      at = this.line.project(pt, p.s0 - 20, p.s1 + 20)?.s ?? p.s0 + this.w.net.pathS(p.ref, edgeS) - p.path0;
      this.alongCache.set(key, at);
    }
    return at;
  }

  private edgePoints(id: string): Vec2[] {
    let pts = this.edgePts.get(id);
    if (!pts) this.edgePts.set(id, pts = this.w.d.graph.edges.find(e => e.id === id)!.points);
    return pts;
  }

  private lights(p: Piece, front: number, v: number, target: (gap: number, vMax: number, reason: string) => void): void {
    if (!this.style.obeyLights) return;
    const { net, signals } = this.w;
    const lane = net.path(p.ref);
    const from = this.edgeAt(p, Math.min(Math.max(p.s0, front - 0.5), p.s1));
    const light = signals.approachState(p.ref.edgeId, p.ref.dir, from, [lane.startAt, lane.endAt]);
    if (!light) return;
    const lineS = this.along(p, light.stopAt);
    const gap = lineS - front;
    if (gap < -0.3 || gap > LOOKAHEAD) return;
    const key = `${p.ref.edgeId}|${p.ref.dir}|${light.stopAt.toFixed(1)}`;
    const state: LightState = light.state;
    if (state !== 'yellow') this.yellow.delete(key);
    let stop = state === 'red' || state === 'redYellow';
    if (state === 'yellow') {
      if (!this.yellow.has(key)) {
        // Decided on the yellow rule's own measure, along the edge centreline: on a bend it differs from the lane's.
        const ruleGap = (light.stopAt - this.edgeAt(p, Math.max(this.s, p.s0))) * p.ref.dir - FRONT_OFFSET;
        this.yellow.set(key, gap > 0 && ruleGap > 0 && canStopBefore(v, ruleGap, YELLOW_MAX_DECEL + 0.05));
      }
      stop = this.yellow.get(key)!;
    }
    if (stop) target(gap - STOP_GAP, 0, `light ${state} ${key}`);
  }

  private crossings(p: Piece, front: number, v: number, dt: number, target: (gap: number, vMax: number, reason: string) => void): void {
    const { d, peds, net } = this.w;
    const lead = this.leader();
    for (const c of d.crossings) {
      if (c.edgeId !== p.ref.edgeId) continue;
      const lane = net.path(p.ref);
      const u = net.pathS(p.ref, c.at);
      if (u < p.path0 - 1 || u > lane.length + JUNCTION_CROSSING) continue;
      const cs = this.along(p, c.at);
      const band = cs - CROSSING_HALF_DEPTH - front;
      if (band < -0.2 || band > LOOKAHEAD) continue;
      const onRoad = peds.occupied(c.id);
      const curb = c.kind === 'zebra' && peds.curbWaiting(c.id);
      let still = this.curbStill.get(c.id) ?? 0;
      still = v < STOP_SPEED && band > 0 && band < 6 ? still + dt : curb ? still : 0;
      this.curbStill.set(c.id, still);
      if (onRoad) target(band - STOP_GAP, 0, `pedestrian on ${c.id}`);
      else if (curb && still < CURB_RELEASE && (v * v) / (2 * Math.max(band - STOP_GAP, 0.01)) <= MAX_DECEL) target(band - STOP_GAP, 0, `pedestrian waiting ${c.id}`);
      // Never enter a marked crossing without room to clear it: a car standing just beyond, or someone walking there.
      if (c.kind !== 'unmarked' && band > 0) {
        const beyond = front + band + 2 * CROSSING_HALF_DEPTH;
        // Too close to the junction to wait between them: cross only once nobody is turning through it, and with
        // room behind a car ahead however fast it goes, since it may stop in the junction for its own turn.
        const nearJunction = p.s1 - beyond < PLAYER_LENGTH + 1 && p.step < this.steps.length - 1;
        const blocked = (lead && lead.speed < QUEUE_SPEED && lead.gap - (band + 2 * CROSSING_HALF_DEPTH) - 1 < PLAYER_LENGTH)
          || this.pedNear(beyond, beyond + PLAYER_LENGTH + 2)
          || (nearJunction && this.junctionBusy(p));
        if (blocked) target(band - STOP_GAP, 0, `keep ${c.id} clear`);
      }
    }
  }

  private junction(p: Piece, front: number, dt: number, target: (gap: number, vMax: number, reason: string) => void): void {
    const i = p.step;
    if (i === this.steps.length - 1) return;
    if (this.greenLeft(p, dt, target)) return;
    const gap = p.s1 - front;
    // The yield rule judges when the centre enters the junction, so a crawling car may still wait until then.
    if (gap > LOOKAHEAD || this.s > p.s1 - 0.2 || (gap < -0.3 && this.v > CRAWL)) return;
    const ref = this.steps[i];
    if (gap >= -0.3 && this.road.junctionSigns(ref).some(g => g.code === CODE.stop) && !this.stopSignDone.has(i)) {
      this.stopSignStill = this.v < STOP_SPEED && gap < 9 ? this.stopSignStill + dt : 0;
      if (this.stopSignStill >= STOP_SIGN_HOLD) this.stopSignDone.add(i);
      else return target(gap - 0.5, 0, `stop sign ${i}`);
    }
    if (gap > SIGNAL_REACH) return;
    const conflicts = this.conflictsAt(ref);
    const mine = this.road.rank(ref);
    if (this.signalledApproach[i]) return;
    const priority = conflicts.filter(c => !c.onConnector && (c.rank > mine || (c.rank === mine && c.fromRight)));
    // Standing at its line it may move off as the player enters; after a long wait it is waiting for the player.
    const threat = this.pickThreat(priority, gap < WAIT_NEAR_LINE, dt);
    if (!threat) return;
    // Lanes a few metres long join two junctions into one; the wait belongs before the first of them.
    let stop = p;
    for (let k = this.pieces.indexOf(p) - 2; k >= 0; k -= 2) {
      const prev = this.pieces[k];
      if (stop.s1 - stop.s0 >= SHORT_LANE || prev.s1 < front - 0.3) break;
      stop = prev;
    }
    target(stop.s1 - front - 0.5, 0, `yield to ${threat.agentId} at ${i}`);
  }

  /**
   * A left turn at lights waits at the junction mouth while oncoming traffic comes on or is about to move off its
   * line, and can still stop inside until its heading has turned LEFT_WAIT_ANGLE, short of the rule's commit.
   */
  private greenLeft(p: Piece, dt: number, target: (gap: number, vMax: number, reason: string) => void): boolean {
    const i = p.step;
    const conn = this.pieces.find(q => q.kind === 'conn' && q.step === i)!;
    const turn = turnBetween(this.w.net, this.steps[i], conn.endRef);
    if (!this.signalledApproach[i] || (turn !== 'left' && turn !== 'uturn')) return false;
    const mouth = conn.s0 - FRONT_OFFSET - 0.3;
    const h0 = this.line.at(conn.s0 - 1).heading;
    let inside = conn.s0;
    while (inside < conn.s1 && Math.abs(wrapAngle(this.line.at(inside).heading - h0)) < LEFT_WAIT_ANGLE) inside += 0.25;
    // A car stopped at `inside` stands a little short of it and keeps watching until it moves off.
    if (this.s > inside || mouth - this.s > LOOKAHEAD) return true;
    const outside = this.s < mouth - 0.2;
    // Outside, a car standing at its line may move off on green. Inside, the player stands in its way, so it waits
    // for the player and only moving cars count, or the two would hold each other forever.
    const oncoming = this.conflictsAt(this.steps[i]).filter(c => c.oncoming && (c.turn === 'straight' || c.turn === null));
    const threat = this.pickThreat(outside ? oncoming : oncoming.filter(c => c.speed > YIELD_MOVING), outside && mouth - this.s < WAIT_NEAR_LINE, dt);
    if (threat) target((outside ? mouth : inside) - this.s, 0, `oncoming ${threat.agentId} at ${i}`);
    return true;
  }

  /**
   * A moving car due within the margin, else one standing at its line until the player has waited YIELD_PATIENCE
   * for it at the line; patience only grows while such a car is the reason for waiting.
   */
  private pickThreat(cars: DriveSnapshot['junctionConflicts'], atLine: boolean, dt: number): DriveSnapshot['junctionConflicts'][number] | undefined {
    const moving = cars.find(c => c.speed > YIELD_MOVING && c.tta < YIELD_MARGIN_TTA);
    const standing = cars.find(c => c.speed <= YIELD_MOVING && c.tta * Math.max(c.speed, 0.1) < WAITING_AT_LINE);
    if (this.v >= STOP_SPEED) this.yieldWait = 0;
    else if (!moving && standing && atLine) this.yieldWait += dt;
    return moving ?? (standing && this.yieldWait < YIELD_PATIENCE ? standing : undefined);
  }

  /** The snapshot's junction conflicts for a car standing at the end of `ref`. */
  private conflictsAt(ref: LaneRef): DriveSnapshot['junctionConflicts'] {
    const key = `${ref.edgeId}|${ref.dir}`;
    const cached = this.conflictCache.get(key);
    if (cached) return cached;
    const found = this.buildConflicts(ref);
    this.conflictCache.set(key, found);
    return found;
  }

  private buildConflicts(ref: LaneRef): DriveSnapshot['junctionConflicts'] {
    const { d, net, signals, signs, peds, traffic } = this.w;
    const match = { ref, edgeS: net.path(ref).endAt, lateral: 0, inJunction: null, onConnector: false, confidence: 1, held: Infinity };
    const pose = this.pose;
    return buildSnapshot(
      { d, net, signals, signs, peds, traffic, playerLength: PLAYER_LENGTH, matcher: { update: () => match } },
      {
        t: 0, dt: 0, position: pose.position, heading: pose.heading, speed: this.v, prevSpeed: this.v,
        drivetrain: { gearbox: 'auto', gear: 1, rpm: 800, running: true }, cabin: this.cabin, steer: 0, events: [],
      },
    ).junctionConflicts;
  }

  /**
   * A car whose straight-line course over the next seconds meets the car's own planned course, such as one turning
   * across the player's lane at a junction. Returns the front's gap to where the boxes would first touch.
   */
  private cutIn(): { id: number; gap: number } | null {
    const me = this.pose.position;
    let best: { id: number; gap: number } | null = null;
    for (const a of this.w.traffic.agents) {
      if (!a.active || Math.abs(a.position[0] - me[0]) > 30 || Math.abs(a.position[1] - me[1]) > 30) continue;
      const k = CAR_CLASSES[a.carClass];
      // One that waits for us with its box already touching ours stands beside or behind: driving on frees it.
      const touching = boxesOverlap({ p: me, h: this.pose.heading, l: PLAYER_LENGTH, w: PLAYER_WIDTH }, { p: a.position, h: a.heading, l: k.length, w: k.width });
      if (touching && a.speed < YIELD_MOVING && this.w.traffic.inspect(a.id)?.heldByPlayer) continue;
      for (let tau = CUT_STEP; tau <= CUT_HORIZON + 1e-9; tau += CUT_STEP) {
        const ahead = this.s + Math.max(this.v, 2) * tau;
        const mine = this.line.at(ahead);
        const p: Vec2 = [a.position[0] + Math.sin(a.heading) * a.speed * tau, a.position[1] + Math.cos(a.heading) * a.speed * tau];
        // A standing car only matters if the boxes would really touch; with a margin, one waiting at its line beside
        // the turn and waiting for the player would hold both for good.
        const m = a.speed < YIELD_MOVING ? 0 : CUT_MARGIN;
        const hit = boxesOverlap(
          { p: mine.position, h: mine.heading, l: PLAYER_LENGTH + 2 * m, w: PLAYER_WIDTH + 2 * m },
          { p, h: a.heading, l: k.length, w: k.width },
        );
        if (!hit) continue;
        // Cars already ahead on the same course are the leader's business.
        if (Math.abs(wrapAngle(a.heading - mine.heading)) < Math.PI / 12 && tau === CUT_STEP) break;
        let gap = Math.max(0, ahead - this.s - PLAYER_LENGTH / 2 - CUT_MARGIN - 1);
        // A car turning inside the junction sweeps more than its box: wait at the junction mouth, not in its path.
        const here = this.piece(this.s);
        if (this.w.traffic.inspect(a.id)?.connectorNode && here.kind === 'lane' && here.s1 - this.s - FRONT_OFFSET > 0) {
          gap = Math.min(gap, here.s1 - this.s - FRONT_OFFSET - 0.5);
        }
        if (!best || gap < best.gap) best = { id: a.id, gap };
        break;
      }
    }
    return best;
  }

  /** An AI car is on a connector of the junction at the end of this lane piece, or about to reach it. */
  private junctionBusy(p: Piece): boolean {
    const e = this.w.d.graph.edges.find(x => x.id === p.ref.edgeId)!;
    const node = p.ref.dir === 1 ? e.to : e.from;
    if (this.w.traffic.agents.some(a => a.active && this.w.traffic.inspect(a.id)?.connectorNode === node)) return true;
    return this.conflictsAt(this.steps[p.step]).some(c => c.speed > YIELD_MOVING && c.tta < BUSY_TTA);
  }

  /** Someone on the path between polyline distances `from` and `to`. */
  private pedNear(from: number, to: number): boolean {
    const me = this.pose.position;
    return this.w.peds.peds.some(q => {
      if (!q.active || Math.abs(q.position[0] - me[0]) > 40 || Math.abs(q.position[1] - me[1]) > 40) return false;
      const hit = this.line.project(q.position, from, to);
      return !!hit && hit.lateral < PLAYER_WIDTH / 2 + PED_CLEARANCE;
    });
  }


  /** No car in the target lane alongside, close ahead, or closing from behind. */
  private gapFree(into: LaneRef): boolean {
    const me = this.pose.position;
    const lane = this.w.net.path(into);
    const mine = project(lane.points, me);
    for (const a of this.w.traffic.agents) {
      if (!a.active) continue;
      const x = this.w.traffic.inspect(a.id);
      if (!x || x.connectorNode || x.ref.edgeId !== into.edgeId || x.ref.dir !== into.dir || x.ref.lane !== into.lane) continue;
      const rel = x.s - mine;
      const behind = LANE_GAP_BEHIND + LANE_GAP_TIME * Math.max(0, a.speed - this.v);
      if (rel > -behind && rel < LANE_GAP_AHEAD) return false;
    }
    return true;
  }

  /** Nearest car on the path ahead, bumper to bumper, with its speed along the path. */
  private leader(): { id: number; gap: number; speed: number } | null {
    const me = this.pose.position;
    let best: { id: number; gap: number; speed: number } | null = null;
    for (const a of this.w.traffic.agents) {
      if (!a.active) continue;
      if (Math.abs(a.position[0] - me[0]) > LOOKAHEAD + 10 || Math.abs(a.position[1] - me[1]) > LOOKAHEAD + 10) continue;
      const hit = this.line.project(a.position, this.s, this.s + LOOKAHEAD);
      if (!hit || hit.lateral > PATH_HALF_WIDTH || hit.s <= this.s) continue;
      const len = CAR_CLASSES[a.carClass].length;
      const gap = hit.s - this.s - PLAYER_LENGTH / 2 - len / 2;
      const speed = Math.max(0, a.speed * Math.cos(wrapAngle(a.heading - hit.heading)));
      if (!best || gap < best.gap) best = { id: a.id, gap, speed };
    }
    return best;
  }

  /**
   * Steer input as a keyboard driver makes it: taps of A or D, ramped like InputReader, whose average follows the
   * steer the path's curvature needs. The path is followed exactly whatever this says; it feeds the indicator stalk.
   */
  private keyboardSteer(dt: number): void {
    const k = wrapAngle(this.line.at(this.s + 1).heading - this.line.at(this.s - 1).heading) / 2;
    // Heading falls turning right, and steer is positive to the right.
    const target = Math.max(-1, Math.min(1, (-Math.atan(WHEELBASE * k) * (1 + this.v / STEER_FALLOFF_SPEED)) / MAX_STEER));
    this.steerDebt += (target - this.steer) * dt;
    if (this.steerKey === 0 && Math.abs(this.steerDebt) > KEY_TAP) this.steerKey = Math.sign(this.steerDebt);
    else if (this.steerKey !== 0 && Math.sign(this.steerDebt) !== this.steerKey) this.steerKey = 0;
    const rate = this.steerKey !== 0 && Math.sign(this.steerKey) !== -Math.sign(this.steer) ? KEY_STEER_IN : KEY_STEER_OUT;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, this.steerKey - this.steer));
  }

  /**
   * Indicator and mirror glances for the next maneuver, through the real stalk: Z or X when the wanted side changes,
   * and off by hand only if the stalk has not cancelled itself.
   */
  private signal(t: number): void {
    const front = this.s + FRONT_OFFSET;
    let side: Indicator | null = null;
    const next = this.signalling.find(m => m.until > this.s);
    if (next) {
      const lead = Math.max(SIGNAL_LEAD_TIME * this.v, SIGNAL_LEAD_MIN);
      if (next.at - front <= lead) side = next.side;
    }
    if (!side && this.s < this.pieces[0].s0 + PULL_OFF_CANCEL) side = 'left';
    const want = this.style.indicators ? side : null;
    let toggle: Indicator | null = null;
    if (want !== this.wantSignal) {
      if (want && this.cabin.indicator !== want) toggle = want;
      else if (!want && this.cabin.indicator) toggle = this.cabin.indicator;
      this.wantSignal = want;
    }
    let glance: Glance | null = null;
    if (side && t - this.lastGlance >= GLANCE_EVERY) {
      glance = side;
      this.lastGlance = t;
    }
    const c: Controls = {
      throttle: 0, brake: 0, clutch: 0, steer: this.steer, handbrake: false, shiftUp: false, shiftDown: false, ignition: false,
      toggleLeft: toggle === 'left', toggleRight: toggle === 'right', toggleHazard: false, toggleBelt: false, glance,
    };
    this.cabin = stepCabin(this.cabin, c, t, this.pose.heading);
  }

  /** Collision and pedestrian-hit events the physics would report, from box overlap. */
  private contacts(t: number): GameEvent[] {
    const player = this.player();
    const out: GameEvent[] = [];
    const now = new Set<number>();
    const mine = { p: player.position, h: player.heading, l: PLAYER_LENGTH, w: PLAYER_WIDTH };
    for (const a of this.w.traffic.agents) {
      if (!a.active) continue;
      if (Math.abs(a.position[0] - mine.p[0]) > 15 || Math.abs(a.position[1] - mine.p[1]) > 15) continue;
      const k = CAR_CLASSES[a.carClass];
      if (!boxesOverlap(mine, { p: a.position, h: a.heading, l: k.length, w: k.width })) continue;
      now.add(a.id);
      if (!this.touching.has(a.id)) out.push({ type: 'collision', with: 'car', speed: closingSpeed(player, a), time: t, approach: approachSpeeds(player, a) });
    }
    this.touching = now;
    if (canHitPedestrian(player.speed)) {
      for (const id of this.w.peds.hitTest(player)) {
        out.push({ type: 'pedestrianHit', pedId: id, speed: Math.abs(player.speed), time: t });
        this.w.peds.remove(id);
      }
    }
    return out;
  }
}

export interface ExamRun {
  result: ExamResult;
  driver: ScriptedDriver;
  /** IndicatorRule and PullOffRule over the whole drive, since the session stops judging once the exam is failed. */
  signalling: Violation[];
  /** Sim seconds from session start to its end, or to the cap. */
  seconds: number;
  prompts: readonly Prompt[];
  replanFailures: number;
  ended: boolean;
}

const DT = 1 / 60;
const WARMUP = 30;
const START_CLEAR = 40;

export function loadWorld(traffic: { cars: number; crossers: number; walkers: number; seed?: number }, routeId = 'route-1'): DriverWorld {
  const root = new URL('../../public/districts/tashkent-center/', import.meta.url);
  const d: DistrictData = JSON.parse(readFileSync(new URL('district.json', root), 'utf8'));
  const route: ExamRoute = JSON.parse(readFileSync(new URL(`routes/${routeId}.json`, root), 'utf8'));
  const net = new LaneNetwork(d);
  const signals = new SignalSystem(d);
  const signs = new SignSystem(d);
  return {
    d, net, signals, signs, route,
    traffic: new TrafficSim(d, net, signals, { count: traffic.cars, seed: traffic.seed ?? 1 }, signs),
    peds: new PedSim(d, { crossers: traffic.crossers, walkers: traffic.walkers, seed: (traffic.seed ?? 1) + 1 }),
  };
}

/** Same step order as main.ts: lights, traffic, pedestrians, the car, then the exam. */
/** `driveOn` keeps driving to the finish after the exam has ended, for the full-route signalling count. */
export function runExam(
  w: DriverWorld, style: DriverStyle, opts: { driveOn?: boolean; capSeconds?: number; watch?: (s: DriveSnapshot, d: ScriptedDriver) => void } = {},
): ExamRun {
  const { driveOn = false, capSeconds = 1500, watch } = opts;
  const driver = new ScriptedDriver(w, style);
  const road = new RoadInfo(w.d, w.net, w.signs);
  const observer = new RuleEngine([new IndicatorRule(road), new PullOffRule()]);
  const signalling: Violation[] = [];
  let t = 0;
  const tick = () => {
    const player = driver.player();
    w.signals.update(DT);
    w.traffic.step(DT, player, w.peds);
    w.peds.step(DT, player, w.traffic.agents, w.signals);
    t += DT;
  };
  for (let i = 0; i < WARMUP / DT; i++) tick();

  const session = new ExamSession({
    d: w.d, net: w.net, signals: w.signals, signs: w.signs, peds: w.peds, traffic: w.traffic,
    penalties: loadPenalties(), playerLength: PLAYER_LENGTH,
    placeCar: pose => {
      driver.place();
      w.traffic.clearNear(pose.position, START_CLEAR);
      w.peds.clearNear(pose.position, START_CLEAR);
    },
  });
  session.start('uz', 'auto', w.route, true);
  observer.reset();
  const t0 = t;
  while (t - t0 < capSeconds && (session.active || (driveOn && !driver.finished))) {
    tick();
    const frame = driver.step(t, DT);
    if (session.active) session.step(frame);
    if (driver.snapshot) {
      signalling.push(...observer.update(driver.snapshot));
      watch?.(driver.snapshot, driver);
    }
  }
  signalling.push(...observer.flush());
  const result = session.result!;
  return { result, driver, signalling, seconds: t - t0, ended: !session.active, prompts: session.prompts, replanFailures: session.replanFailures };
}
