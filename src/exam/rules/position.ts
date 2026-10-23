import type { DriveSnapshot } from '../snapshot';
import type { RoadInfo } from './road';
import {
  CROSSING_HALF_DEPTH, CROSSING_OVERLAP, EPS, FRONT_OFFSET, ONCOMING_HOLD, ONCOMING_LATERAL, STOPPED_ON_CROSSING_HOLD, STOP_SPEED,
} from './thresholds';
import { violation, type Rule, type Violation } from './types';

/** Overtaking over a dashed line is not modelled, so any stay over the divider counts. */
export class OncomingLaneRule implements Rule {
  readonly id = 'oncomingLane';
  private held = 0;
  private charged = false;

  constructor(private readonly road: RoadInfo) {}

  update(s: DriveSnapshot): Violation[] {
    const ref = s.match.ref;
    const over = !!ref && s.speed >= 0 && s.match.inJunction === null && !s.match.onConnector && this.road.twoWay(ref)
      && s.match.lateral < this.road.divider(ref) - ONCOMING_LATERAL;
    if (!over) {
      this.reset();
      return [];
    }
    this.held += s.dt;
    if (this.charged || this.held < ONCOMING_HOLD - EPS) return [];
    this.charged = true;
    return [violation('oncomingLane', s, { edge: ref.edgeId })];
  }

  reset(): void {
    this.held = 0;
    this.charged = false;
  }
}

/** The car is taken as FRONT_OFFSET either side of its centre; unmarked crossings have no band to keep clear. */
export class StoppedOnCrossingRule implements Rule {
  readonly id = 'stoppedOnCrossing';
  private still = 0;
  private charged = false;

  update(s: DriveSnapshot): Violation[] {
    if (Math.abs(s.speed) >= STOP_SPEED) {
      this.reset();
      return [];
    }
    this.still += s.dt;
    if (this.charged || this.still < STOPPED_ON_CROSSING_HOLD - EPS) return [];
    const reach = FRONT_OFFSET + CROSSING_HALF_DEPTH - CROSSING_OVERLAP;
    const on = s.crossingsAhead.find(c => c.kind !== 'unmarked' && Math.abs(c.distance) < reach);
    if (!on) return [];
    this.charged = true;
    return [violation('stoppedOnCrossing', s, { crossing: on.id })];
  }

  reset(): void {
    this.still = 0;
    this.charged = false;
  }
}
