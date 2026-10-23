import type { DriveSnapshot } from '../snapshot';
import { ManeuverWatch } from './maneuvers';
import type { RoadInfo } from './road';
import { violation, type Rule, type Violation } from './types';

/** Judged from the lane the player actually held before the junction, not the route's planned lane. */
export class WrongLaneForTurnRule implements Rule {
  readonly id = 'wrongLaneForTurn';
  private readonly watch: ManeuverWatch;

  constructor(private readonly road: RoadInfo) {
    this.watch = new ManeuverWatch(road);
  }

  update(s: DriveSnapshot): Violation[] {
    const m = this.watch.update(s);
    if (m?.kind !== 'turn' || !m.side) return [];
    const lanes = this.road.lanes(m.from);
    if (lanes < 2) return [];
    const wanted = m.side === 'left' ? lanes - 1 : 0;
    return m.from.lane === wanted ? [] : [violation('wrongLaneForTurn', s, { turn: m.turn, lane: m.from.lane, lanes })];
  }

  reset(): void {
    this.watch.reset();
  }
}
