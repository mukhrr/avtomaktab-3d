import type { Indicator } from '../../vehicle/cabin';
import type { DriveSnapshot } from '../snapshot';
import { ManeuverWatch, type Maneuver } from './maneuvers';
import type { RoadInfo } from './road';
import { BELT_SPEED, EPS, INDICATOR_LEAD, MIRROR_WINDOW, STOP_SPEED, kmh } from './thresholds';
import { violation, type Rule, type Violation } from './types';

type Sided = Maneuver & { side: Indicator };

abstract class ManeuverRule implements Rule {
  abstract readonly id: string;
  private readonly watch: ManeuverWatch;

  constructor(road: RoadInfo) {
    this.watch = new ManeuverWatch(road);
  }

  update(s: DriveSnapshot): Violation[] {
    const m = this.watch.update(s);
    if (!m?.side) return [];
    const v = this.judge(s, { ...m, side: m.side });
    return v ? [v] : [];
  }

  reset(): void {
    this.watch.reset();
  }

  protected abstract judge(s: DriveSnapshot, m: Sided): Violation | null;
}

const what = (m: Maneuver) => ({ maneuver: m.kind === 'turn' ? m.turn : `lane-${m.side}`, start: m.start });

/** The matching indicator must have been on for INDICATOR_LEAD before the maneuver started. Hazards are not an indicator. */
export class IndicatorRule extends ManeuverRule {
  readonly id = 'noIndicator';
  protected judge(s: DriveSnapshot, m: Sided): Violation | null {
    const ok = m.indicator === m.side && m.start - m.indicatorSince >= INDICATOR_LEAD - EPS;
    return ok ? null : violation('noIndicator', s, what(m));
  }
}

export class MirrorCheckRule extends ManeuverRule {
  readonly id = 'noMirrorCheck';
  protected judge(s: DriveSnapshot, m: Sided): Violation | null {
    const ago = m.start - m.lastGlance[m.side];
    return ago >= 0 && ago <= MIRROR_WINDOW + EPS ? null : violation('noMirrorCheck', s, what(m));
  }
}

/** The first forward move off from rest after reset is the pull-off from the route start's curb. */
export class PullOffRule implements Rule {
  readonly id = 'noIndicatorPullOff';
  private rested = false;
  private done = false;

  update(s: DriveSnapshot): Violation[] {
    if (this.done) return [];
    if (Math.abs(s.speed) < STOP_SPEED) this.rested = true;
    if (!this.rested || s.speed < STOP_SPEED) return [];
    this.done = true;
    const lit = s.cabin.hazard ? null : s.cabin.indicator;
    return lit === 'left' ? [] : [violation('noIndicatorPullOff', s)];
  }

  reset(): void {
    this.rested = false;
    this.done = false;
  }
}

export class SeatBeltRule implements Rule {
  readonly id = 'noSeatBelt';
  private done = false;

  update(s: DriveSnapshot): Violation[] {
    if (this.done || s.cabin.belt || kmh(s.speed) <= BELT_SPEED) return [];
    this.done = true;
    return [violation('noSeatBelt', s)];
  }

  reset(): void {
    this.done = false;
  }
}
