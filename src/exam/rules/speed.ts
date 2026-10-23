import type { DriveSnapshot } from '../snapshot';
import {
  EPS, SEVERE_OVER, SEVERE_SUSTAINED_HOLD, SEVERE_SUSTAINED_OVER, SPEEDING_PERIOD, SPEED_TOLERANCE,
  TAILGATE_HEADWAY, TAILGATE_HOLD, TAILGATE_MIN_SPEED, TAILGATE_REPEAT, kmh,
} from './thresholds';
import { violation, type Rule, type Violation } from './types';

/** speeding and speedingSevere together, so one stretch over the limit is charged once at the worse tier. */
export class SpeedRule implements Rule {
  readonly id = 'speed';
  private over = 0;
  private sustained = 0;
  private severe = false;

  update(s: DriveSnapshot): Violation[] {
    const by = s.speedLimit > 0 ? kmh(s.speed) - s.speedLimit : -Infinity;
    if (by <= SPEED_TOLERANCE) {
      this.reset();
      return [];
    }
    this.over += s.dt;
    this.sustained = by > SEVERE_SUSTAINED_OVER ? this.sustained + s.dt : 0;
    if (this.severe) return [];
    if (by > SEVERE_OVER || this.sustained >= SEVERE_SUSTAINED_HOLD - EPS) {
      this.severe = true;
      return [violation('speedingSevere', s, { limit: s.speedLimit, kmh: Math.round(kmh(s.speed)) })];
    }
    if (this.over < SPEEDING_PERIOD - EPS) return [];
    this.over -= SPEEDING_PERIOD;
    return [violation('speeding', s, { limit: s.speedLimit, kmh: Math.round(kmh(s.speed)) })];
  }

  reset(): void {
    this.over = 0;
    this.sustained = 0;
    this.severe = false;
  }
}

export class TailgatingRule implements Rule {
  readonly id = 'tailgating';
  private held = 0;
  private last = -Infinity;

  update(s: DriveSnapshot): Violation[] {
    const close = s.leader !== null && kmh(s.speed) > TAILGATE_MIN_SPEED && s.leader.distance / Math.abs(s.speed) < TAILGATE_HEADWAY;
    this.held = close ? this.held + s.dt : 0;
    if (this.held < TAILGATE_HOLD - EPS || s.t - this.last < TAILGATE_REPEAT - EPS) return [];
    this.last = s.t;
    return [violation('tailgating', s, { headway: Math.round((s.leader!.distance / Math.abs(s.speed)) * 100) / 100 })];
  }

  reset(): void {
    this.held = 0;
    this.last = -Infinity;
  }
}
