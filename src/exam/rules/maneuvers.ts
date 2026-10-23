import type { LaneRef } from '../../traffic/lanes';
import type { Turn } from '../../traffic/turns';
import type { Indicator } from '../../vehicle/cabin';
import type { Glance } from '../../vehicle/drivetrain';
import type { DriveSnapshot } from '../snapshot';
import type { RoadInfo } from './road';
import { EPS, EXIT_SETTLE_DISTANCE, INDICATOR_LEAD, INDICATOR_RECENT, LANE_CHANGE_HOLD } from './thresholds';

export interface Maneuver {
  kind: 'turn' | 'laneChange';
  turn: Turn;
  /** The indicator and mirror side it needs; null for straight on. A U-turn counts as left. */
  side: Indicator | null;
  from: LaneRef;
  to: LaneRef;
  /** Junction entry for a turn, the step the lane index changed for a lane change. */
  start: number;
  /** Cabin state captured at `start`, since the stalk auto-cancels during the turn; a recent signal counts as on. */
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
  /** The last time each side was lit, for a stalk that went off just before the lane index changed. */
  private spans: Record<Indicator, { on: number; off: number } | null> = { left: null, right: null };
  /** Switch-on time of the signal the last judged maneuver used, so one signal is not credited to two maneuvers. */
  private used = -Infinity;
  private settled: LaneRef | null = null;
  private transit: (Captured & { from: LaneRef | null; reversed: boolean }) | null = null;
  private pending: (Captured & { to: LaneRef; held: number }) | null = null;
  /** After a junction exit, lane readings settle before lane changes are watched again. */
  private settling: { held: number; travelled: number } | null = null;

  constructor(private readonly road: RoadInfo) {}

  update(s: DriveSnapshot): Maneuver | null {
    const lit = s.cabin.hazard ? null : s.cabin.indicator;
    if (lit !== this.indicator) {
      if (this.indicator) this.spans[this.indicator] = { on: this.indicatorSince, off: s.t };
      this.indicator = lit;
      this.indicatorSince = s.t;
    }
    const ref = s.match.ref;

    if (s.match.inJunction !== null || s.match.onConnector) {
      this.transit ??= { from: this.pending?.to ?? this.settled, reversed: false, ...this.capture(s) };
      this.pending = null;
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
      if (indicator) this.used = indicatorSince;
    }
    if (transit) this.settling = { held: 0, travelled: 0 };

    if (this.settling && ref) {
      const st = this.settling;
      st.held = this.settled && sameRoad(this.settled, ref) && this.settled.lane === ref.lane ? st.held + s.dt : 0;
      st.travelled += Math.abs(s.speed) * s.dt;
      this.settled = ref;
      this.pending = null;
      if (st.held >= LANE_CHANGE_HOLD - EPS || st.travelled >= EXIT_SETTLE_DISTANCE) this.settling = null;
      return out;
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
    if (p.indicator) this.used = p.indicatorSince;
    return { kind: 'laneChange', turn: side, side, from, to: ref, start: p.start, indicator: p.indicator, indicatorSince: p.indicatorSince, lastGlance: p.lastGlance };
  }

  reset(): void {
    this.indicator = null;
    this.indicatorSince = -Infinity;
    this.spans = { left: null, right: null };
    this.used = -Infinity;
    this.settled = null;
    this.transit = null;
    this.pending = null;
    this.settling = null;
  }

  private capture(s: DriveSnapshot): Captured {
    let indicator = this.indicator, indicatorSince = this.indicatorSince;
    if (!indicator) {
      const recent = (['left', 'right'] as const)
        .map(side => ({ side, span: this.spans[side] }))
        .filter(({ span }) => span && span.on !== this.used && s.t - span.off <= INDICATOR_RECENT + EPS && span.off - span.on >= INDICATOR_LEAD - EPS)
        .sort((a, b) => b.span!.off - a.span!.off)[0];
      if (recent) [indicator, indicatorSince] = [recent.side, recent.span!.on];
    }
    return { start: s.t, indicator, indicatorSince, lastGlance: { ...s.cabin.lastGlance } };
  }
}
