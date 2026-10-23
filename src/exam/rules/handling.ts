import type { DriveSnapshot } from '../snapshot';
import {
  EPS, HARSH_CRASH_WINDOW, HARSH_DECEL, HARSH_HOLD, HARSH_REPEAT, ROLLBACK_DISTANCE, ROLLBACK_SPEED, YIELD_MOVING, YIELD_TTA,
  stoppingDistance,
} from './thresholds';
import { violation, type Rule, type Violation } from './types';

/** Anything that explains a hard stop: a light about to stop the car, someone at a crossing, a car close ahead or pulling out. */
function reasonToBrake(s: DriveSnapshot): boolean {
  const light = s.signalAhead?.state;
  if (light === 'red' || light === 'yellow' || light === 'redYellow') return true;
  if (s.crossingsAhead.some(c => c.pedOnCarriageway || c.pedAtCurb)) return true;
  if (s.leader && s.leader.distance < stoppingDistance(Math.abs(s.speed))) return true;
  return s.junctionConflicts.some(c => c.speed > YIELD_MOVING && c.tta < YIELD_TTA);
}

export class HarshBrakingRule implements Rule {
  readonly id = 'harshBraking';
  private held = 0;
  /** A reason seen at any step of the current hard braking excuses all of it. */
  private excused = false;
  private lastCrash = -Infinity;
  private last = -Infinity;

  update(s: DriveSnapshot): Violation[] {
    if (s.events.some(e => e.type === 'pedestrianHit' || e.type === 'collision')) this.lastCrash = s.t;
    if (!(s.speed > 0 && s.accel < -HARSH_DECEL)) {
      this.held = 0;
      this.excused = false;
      return [];
    }
    this.held += s.dt;
    if (!this.excused && (s.t - this.lastCrash <= HARSH_CRASH_WINDOW || reasonToBrake(s))) this.excused = true;
    if (this.excused || this.held < HARSH_HOLD - EPS || s.t - this.last < HARSH_REPEAT - EPS) return [];
    this.last = s.t;
    this.excused = true;
    return [violation('harshBraking', s, { decel: Math.round(-s.accel * 10) / 10 })];
  }

  reset(): void {
    this.held = 0;
    this.excused = false;
    this.lastCrash = -Infinity;
    this.last = -Infinity;
  }
}

export class StallRule implements Rule {
  readonly id = 'stall';
  private running: boolean | null = null;

  update(s: DriveSnapshot): Violation[] {
    const was = this.running;
    this.running = s.running;
    return s.gearbox === 'manual' && was === true && !s.running ? [violation('stall', s)] : [];
  }

  reset(): void {
    this.running = null;
  }
}

/** Neutral is not a forward gear, so rolling back in it is not charged; gear 1 and up is also D on the automatic. */
export class RollBackRule implements Rule {
  readonly id = 'rollBack';
  private travelled = 0;
  private charged = false;

  update(s: DriveSnapshot): Violation[] {
    if (s.speed >= 0 || s.gear < 1) {
      this.reset();
      return [];
    }
    if (s.speed < -ROLLBACK_SPEED) this.travelled += -s.speed * s.dt;
    if (this.charged || this.travelled <= ROLLBACK_DISTANCE + EPS) return [];
    this.charged = true;
    return [violation('rollBack', s, { metres: Math.round(this.travelled * 10) / 10 })];
  }

  reset(): void {
    this.travelled = 0;
    this.charged = false;
  }
}
