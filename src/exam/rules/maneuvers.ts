import type { LaneRef } from '../../traffic/lanes';
import type { Turn } from '../../traffic/turns';
import type { Indicator } from '../../vehicle/cabin';
import type { Glance } from '../../vehicle/drivetrain';
import type { DriveSnapshot } from '../snapshot';
import type { RoadInfo } from './road';
import { EPS, LANE_CHANGE_HOLD } from './thresholds';

export interface Maneuver {
  kind: 'turn' | 'laneChange';
  turn: Turn;
  /** The indicator and mirror side it needs; null for straight on. A U-turn counts as left. */
  side: Indicator | null;
  from: LaneRef;
  to: LaneRef;
  /** Junction entry for a turn, the step the lane index changed for a lane change. */
  start: number;
  /** Cabin state captured at `start`, since the stalk auto-cancels during the turn. */
  indicator: Indicator | null;
  indicatorSince: number;
  lastGlance: Record<Glance, number>;
}

interface Captured { start: number; indicator: Indicator | null; indicatorSince: number; lastGlance: Record<Glance, number> }

const sameRoad = (a: LaneRef, b: LaneRef) => a.edgeId === b.edgeId && a.dir === b.dir;

/**
 * Turns across junctions (approach lane to exit lane) and lane changes on one edge held for LANE_CHANGE_HOLD.
 * Lanes are not read inside junctions, and anything done while reversing is not a maneuver.
 */
export class ManeuverWatch {
  private indicator: Indicator | null = null;
  private indicatorSince = -Infinity;
  private settled: LaneRef | null = null;
  private transit: (Captured & { from: LaneRef | null; reversed: boolean }) | null = null;
  private pending: (Captured & { to: LaneRef; held: number }) | null = null;

  constructor(private readonly road: RoadInfo) {}

  update(s: DriveSnapshot): Maneuver | null {
    const lit = s.cabin.hazard ? null : s.cabin.indicator;
    if (lit !== this.indicator) {
      this.indicator = lit;
      this.indicatorSince = s.t;
    }
    const ref = s.match.ref;

    if (s.match.inJunction !== null || s.match.onConnector) {
      this.pending = null;
      this.transit ??= { from: this.settled, reversed: false, ...this.capture(s) };
      if (s.speed < 0) this.transit.reversed = true;
      return null;
    }

    let out: Maneuver | null = null;
    const transit = this.transit;
    this.transit = null;
    if (transit?.from && ref && !transit.reversed && s.speed >= 0 && !sameRoad(transit.from, ref)) {
      const { from, start, indicator, indicatorSince, lastGlance } = transit;
      const turn = this.road.turn(from, ref);
      const side = turn === 'straight' ? null : turn === 'right' ? 'right' : 'left';
      out = { kind: 'turn', turn, side, from, to: ref, start, indicator, indicatorSince, lastGlance };
    }

    if (!ref || s.speed < 0 || !this.settled || !sameRoad(this.settled, ref) || ref.lane === this.settled.lane) {
      this.settled = ref;
      this.pending = null;
      return out;
    }
    if (this.pending?.to.lane !== ref.lane) this.pending = { to: ref, held: 0, ...this.capture(s) };
    this.pending.held += s.dt;
    if (this.pending.held < LANE_CHANGE_HOLD - EPS) return null;
    const from = this.settled, p = this.pending;
    this.settled = ref;
    this.pending = null;
    const side = ref.lane > from.lane ? 'left' : 'right';
    return { kind: 'laneChange', turn: side, side, from, to: ref, start: p.start, indicator: p.indicator, indicatorSince: p.indicatorSince, lastGlance: p.lastGlance };
  }

  reset(): void {
    this.indicator = null;
    this.indicatorSince = -Infinity;
    this.settled = null;
    this.transit = null;
    this.pending = null;
  }

  private capture(s: DriveSnapshot): Captured {
    return { start: s.t, indicator: this.indicator, indicatorSince: this.indicatorSince, lastGlance: { ...s.cabin.lastGlance } };
  }
}
