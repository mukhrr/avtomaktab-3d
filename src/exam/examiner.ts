import type { DistrictData, GraphEdge, Vec2 } from '../shared/district';
import { pointAt, type LaneNetwork, type LaneRef } from '../traffic/lanes';
import { project } from '../traffic/turns';
import { segmentDistance } from '../world/spatial';
import { DirectionTracker, type Prompt } from './directions';
import type { PenaltyEntry, PenaltyId } from './penalties';
import type { RuleEngine } from './rules/engine';
import type { Violation } from './rules/types';
import { planRoute, turnBetween, type ExamRoute, type Maneuver, type Pose, type RouteStep } from './route';
import type { DriveSnapshot } from './snapshot';

export type { Prompt };

export type ExamPhase = 'briefing' | 'driving' | 'finished' | 'failed' | 'abandoned';

export interface ExamResult {
  phase: ExamPhase;
  total: number;
  violations: Violation[];
  durationS: number;
  distanceM: number;
  routeId: string;
  passed: boolean;
}

const FAIL_TOTAL = 100;
const FINISH_RADIUS = 15;
const FINISH_SPEED = 0.5;
const FINISH_HOLD = 2;
/** Matcher noise must not trigger a reroute: the car has to be off the route this long. */
const OFF_ROUTE_HOLD = 2;
/** Metres beyond the route road's edge before the car counts as off it, whatever the matcher says. */
const OFF_ROUTE_MARGIN = 3;
/** After a reroute, the next one waits this long, so a match flip-flopping between roads is not voiced again and again. */
const REROUTE_COOLDOWN = 10;
/** Lanes ahead a match may skip, for short edges that the matcher steps over. */
const SKIP_AHEAD = 3;
/** A failed replan from a lane is retried after this long. */
const REROUTE_RETRY = 5;
const SPOKEN_TIERS = new Set(['high', 'fail']);

const sameLane = (a: LaneRef, b: LaneRef) => a.edgeId === b.edgeId && a.dir === b.dir;

export class Examiner {
  private _phase: ExamPhase = 'briefing';
  private steps: RouteStep[];
  private waypoints: Vec2[];
  private finish: Pose;
  private finishS = 0;
  private cur = 0;
  private distance: number;
  private directions = new DirectionTracker();
  /** Pairs an "ahead" prompt with its "now" prompt; bumps whenever the tracker is replaced. */
  private junction = 0;
  private pending: Prompt[] = [];
  private briefed = false;
  private all: Violation[] = [];
  private t0: number | null = null;
  private tEnd = 0;
  private lastT = 0;
  private driven = 0;
  private offSince: number | null = null;
  private stillSince: number | null = null;
  private failedReroute: { key: string; t: number } | null = null;
  private lastReroute = -Infinity;
  private failures = 0;
  private readonly edges: Map<string, GraphEdge>;

  constructor(
    private readonly route: ExamRoute,
    private readonly net: LaneNetwork,
    private readonly penalties: Record<PenaltyId, PenaltyEntry>,
    private readonly d: DistrictData,
    private readonly engine?: Pick<RuleEngine, 'flush'>,
    private readonly planner: typeof planRoute = planRoute,
  ) {
    this.edges = new Map(d.graph.edges.map(e => [e.id, e]));
    this.steps = route.steps;
    this.waypoints = route.waypoints;
    this.finish = route.finish;
    this.finishS = this.finishAlong();
    this.distance = this.alongToManeuver(project(net.path(this.steps[0].ref).points, route.start.position));
  }

  get phase(): ExamPhase {
    return this._phase;
  }

  start(): void {
    if (this._phase !== 'briefing') return;
    this._phase = 'driving';
    this.pending.push({ key: 'exam.start' });
  }

  abandon(): void {
    if (this._phase === 'briefing' || this._phase === 'driving') this.end('abandoned', this.lastT);
  }

  get result(): ExamResult {
    const ended = this._phase !== 'briefing' && this._phase !== 'driving';
    const violations = this.all.filter(v => !ended || v.t <= this.tEnd).sort((a, b) => a.t - b.t);
    const total = violations.reduce((n, v) => n + this.penalties[v.id].points, 0);
    return {
      phase: this._phase, total, violations,
      durationS: this.t0 === null ? 0 : (ended ? this.tEnd : this.lastT) - this.t0,
      distanceM: this.driven, routeId: this.route.id,
      passed: this._phase === 'finished' && !this.failing(violations, total),
    };
  }

  /** Replans that threw, for diagnostics and the headless runs. */
  get replanFailures(): number {
    return this.failures;
  }

  get nextManeuver(): { maneuver: Maneuver; distance: number } | null {
    if (this._phase !== 'driving') return null;
    return { maneuver: this.maneuver(), distance: this.distance };
  }

  update(s: DriveSnapshot, violations: Violation[]): Prompt[] {
    if (this._phase === 'briefing') {
      if (this.briefed) return [];
      this.briefed = true;
      return [{ key: 'exam.brief' }];
    }
    if (this._phase !== 'driving') return [];

    this.t0 ??= s.t;
    this.lastT = s.t;
    this.driven += Math.abs(s.speed) * s.dt;
    const out = this.pending.splice(0);

    for (const v of violations) {
      this.all.push(v);
      out.push(this.violationPrompt(v));
    }
    if (this.failing(this.all, this.sum(this.all))) return [...out, ...this.end('failed', s.t)];
    if (this.outsideDistrict(s.position)) return [...out, ...this.end('abandoned', s.t)];

    this.advance(s, out);
    const lane = this.steps[this.cur].ref;
    const onLane = s.match.ref !== null && sameLane(s.match.ref, lane) && !s.match.inJunction;
    if (onLane) {
      this.distance = this.alongToManeuver(this.net.pathS(lane, s.match.edgeS));
      const straight = s.signalAhead !== null && this.net.exits(lane).length > 1;
      for (const p of this.directions.update(this.distance, this.maneuver(), straight)) out.push({ ...p, vars: { junction: this.junction } });
    }

    if (this.cur === this.steps.length - 1 && this.atRest(s, lane)) return [...out, ...this.end('finished', s.t)];
    return out;
  }

  private sum(vs: Violation[]): number {
    return vs.reduce((n, v) => n + this.penalties[v.id].points, 0);
  }

  private failing(vs: Violation[], total: number): boolean {
    return total >= FAIL_TOTAL || vs.some(v => this.penalties[v.id].tier === 'fail');
  }

  private violationPrompt(v: Violation): Prompt {
    const p = this.penalties[v.id];
    return { key: 'exam.violation', vars: { ...v.detail, id: v.id, points: p.points, tier: p.tier, spoken: SPOKEN_TIERS.has(p.tier) ? 1 : 0 } };
  }

  /** Held violations from the engine count if they happened before the end. */
  private end(phase: ExamPhase, t: number): Prompt[] {
    this.tEnd = t;
    const out: Prompt[] = [];
    for (const v of this.engine?.flush() ?? []) {
      if (v.t > t) continue;
      this.all.push(v);
      out.push(this.violationPrompt(v));
    }
    const kept = this.all.filter(v => v.t <= t);
    this._phase = phase === 'finished' && this.failing(kept, this.sum(kept)) ? 'failed' : phase;
    if (this._phase === 'finished') out.push({ key: 'exam.passed' });
    else if (this._phase === 'failed') out.push({ key: 'exam.failed' });
    return out;
  }

  private outsideDistrict([x, z]: Vec2): boolean {
    const b = this.d.bounds;
    return x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ;
  }

  /** Forward-only: the route can revisit a lane, so it is never searched from the start. */
  private advance(s: DriveSnapshot, out: Prompt[]): void {
    const ref = s.match.ref;
    if (!ref || s.match.inJunction) {
      this.offSince = null;
      return;
    }
    if (sameLane(ref, this.steps[this.cur].ref)) {
      this.offSince = null;
      return;
    }
    for (let k = 1; k <= SKIP_AHEAD; k++) {
      const next = this.steps[this.cur + k];
      if (next && sameLane(ref, next.ref)) {
        this.cur += k;
        this.failedReroute = null;
        this.directions = new DirectionTracker();
        this.junction++;
        this.offSince = null;
        return;
      }
    }
    if (!this.offRoute(s.position, ref)) {
      this.offSince = null;
      return;
    }
    this.offSince ??= s.t;
    if (s.t - this.offSince >= OFF_ROUTE_HOLD - 1e-9 && s.t - this.lastReroute >= REROUTE_COOLDOWN - 1e-9) this.reroute(s, ref, out);
  }

  /** Away from the roads of the next few steps, or on one of them the wrong way. */
  private offRoute(position: Vec2, ref: LaneRef): boolean {
    for (const step of this.steps.slice(this.cur, this.cur + SKIP_AHEAD + 1)) {
      const e = this.edges.get(step.ref.edgeId);
      if (!e) continue;
      if (e.id === ref.edgeId) return ref.dir !== step.ref.dir;
      for (let i = 1; i < e.points.length; i++) {
        if (segmentDistance(position[0], position[1], e.points[i - 1], e.points[i]).d <= e.width / 2 + OFF_ROUTE_MARGIN) return false;
      }
    }
    return true;
  }

  private reroute(s: DriveSnapshot, ref: LaneRef, out: Prompt[]): void {
    const key = `${ref.edgeId}|${ref.dir}`;
    if (this.failedReroute?.key === key && s.t - this.failedReroute.t < REROUTE_RETRY) return;
    const path = this.net.path(ref);
    const at = Math.min(path.length, Math.max(0, this.net.pathS(ref, s.match.edgeS)));
    const here = pointAt(path.points, at).position;
    try {
      const next = this.planner(this.net, this.d, [here, ...this.waypoints.slice(this.steps[this.cur].waypointIndex)], this.route.id, this.route.district);
      if (!sameLane(next.steps[0].ref, ref)) throw new Error('replanned from another lane');
      this.steps = next.steps;
      this.waypoints = next.waypoints;
      this.finish = next.finish;
      this.finishS = this.finishAlong();
      this.failedReroute = null;
      this.cur = 0;
      this.directions = new DirectionTracker();
      this.junction++;
      this.offSince = null;
      this.distance = this.alongToManeuver(at);
      this.lastReroute = s.t;
      out.push({ key: 'exam.reroute' });
    } catch {
      this.failures++;
      this.failedReroute = { key, t: s.t };
      const last = this.steps.length - 1;
      if (sameLane(ref, this.steps[last].ref)) this.cur = last;
    }
  }

  private maneuver(): Maneuver {
    const last = this.steps.length - 1;
    return this.cur === last ? 'finish' : turnBetween(this.net, this.steps[this.cur].ref, this.steps[this.cur + 1].ref);
  }

  /** Metres from `pathS` on the current lane to its maneuver: the lane end, or the finish line on the last lane. */
  private alongToManeuver(pathS: number): number {
    const lane = this.steps[this.cur].ref;
    return (this.cur === this.steps.length - 1 ? this.finishS : this.net.path(lane).length) - pathS;
  }

  private finishAlong(): number {
    return project(this.net.path(this.steps[this.steps.length - 1].ref).points, this.finish.position);
  }

  private atRest(s: DriveSnapshot, lane: LaneRef): boolean {
    const [fx, fz] = this.finish.position;
    const near = s.match.ref !== null && sameLane(s.match.ref, lane)
      && Math.hypot(s.position[0] - fx, s.position[1] - fz) <= FINISH_RADIUS && Math.abs(s.speed) < FINISH_SPEED;
    if (!near) {
      this.stillSince = null;
      return false;
    }
    this.stillSince ??= s.t;
    return s.t - this.stillSince >= FINISH_HOLD - 1e-9;
  }
}
