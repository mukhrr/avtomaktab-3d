import type { Vec2 } from '../../shared/district';
import type { LightState } from '../../sim/signals';
import type { LaneRef } from '../../traffic/lanes';
import { wrapAngle } from '../../traffic/turns';
import type { DriveSnapshot } from '../snapshot';
import type { RoadInfo } from './road';
import {
  CROSSING_HALF_DEPTH, FRONT_OFFSET, LEFT_TURN_COMMIT, SIGNAL_REACH, YIELD_MOVING, YIELD_TTA, stoppingDistance,
} from './thresholds';
import { violation, type Rule, type Violation } from './types';

interface CrossingWatch {
  present: boolean;
  /** Whether the car could still stop when the pedestrian appeared. */
  farEnough: boolean;
  /** Front bumper to the near edge of the band, last step. */
  front: number;
  seen: number;
}

/**
 * Judged when the front enters the band. A pedestrian counts only if the car was outside its stopping distance
 * when they appeared, so one stepping out under the bonnet is no fail (RF3). At a signal crossing people at the
 * curb are waiting for the walk light, so only someone on the carriageway counts there.
 */
export class PedestrianYieldRule implements Rule {
  readonly id = 'pedestrianNotYielded';
  private readonly watches = new Map<string, CrossingWatch>();
  private step = 0;

  update(s: DriveSnapshot): Violation[] {
    this.step++;
    let out: Violation[] | null = null;
    for (const c of s.crossingsAhead) {
      if (c.kind === 'unmarked') continue;
      const present = c.pedOnCarriageway || (c.kind === 'zebra' && c.pedAtCurb);
      const front = c.distance - FRONT_OFFSET - CROSSING_HALF_DEPTH;
      let w = this.watches.get(c.id);
      if (!w) this.watches.set(c.id, w = { present: false, farEnough: false, front, seen: 0 });
      if (present && !w.present) w.farEnough = front > stoppingDistance(Math.abs(s.speed));
      w.present = present;
      if (s.speed > 0 && w.front > 0 && front <= 0 && present && w.farEnough) (out ??= []).push(violation('pedestrianNotYielded', s, { crossing: c.id }));
      w.front = front;
      w.seen = this.step;
    }
    for (const [id, w] of this.watches) if (w.seen !== this.step) this.watches.delete(id);
    return out ?? [];
  }

  reset(): void {
    this.watches.clear();
    this.step = 0;
  }
}

interface Transit {
  from: LaneRef;
  /** Green on entry at a junction the approach's lights control. */
  green: boolean;
  heading: number;
  reversed: boolean;
  /** When the player moved off across an oncoming car with priority, judged at the exit once the turn is known. */
  mark: { t: number; position: Vec2; agent: number } | null;
}

/**
 * Mirrors TrafficSim's arbitration. Unsignalled: a moving car within YIELD_TTA whose approach ranks higher, or
 * equal and from the right, judged on entry. On green: oncoming straight-bound traffic over the player's left turn.
 */
export class VehicleYieldRule implements Rule {
  readonly id = 'vehicleNotYielded';
  private approach: LaneRef | null = null;
  private light: { edgeId: string; dir: 1 | -1; stopAt: number; state: LightState } | null = null;
  private transit: Transit | null = null;
  private unjudged = false;

  constructor(private readonly road: RoadInfo) {}

  update(s: DriveSnapshot): Violation[] {
    const ref = s.match.ref;
    if (s.match.inJunction === null && !s.match.onConnector) {
      const t = this.transit;
      this.transit = null;
      this.unjudged = false;
      if (ref && s.signalAhead) this.light = { edgeId: ref.edgeId, dir: ref.dir, stopAt: s.signalAhead.stopAt, state: s.signalAhead.state };
      else if (this.light && (!ref || ref.edgeId !== this.light.edgeId || ref.dir !== this.light.dir)) this.light = null;
      this.approach = ref;
      if (!t?.mark || t.reversed || !ref || s.speed < 0 || (ref.edgeId === t.from.edgeId && ref.dir === t.from.dir)) return [];
      const turn = this.road.turn(t.from, ref);
      if (turn !== 'left' && turn !== 'uturn') return [];
      return [{ id: 'vehicleNotYielded', t: t.mark.t, position: t.mark.position, detail: { agent: t.mark.agent } }];
    }

    if (!this.transit && !this.unjudged) {
      const from = this.approach;
      if (!from) {
        this.unjudged = true;
        return [];
      }
      const l = this.light;
      const signalled = !!l && l.edgeId === from.edgeId && l.dir === from.dir && Math.abs(this.road.laneEnd(from) - l.stopAt) <= SIGNAL_REACH;
      this.transit = { from, green: signalled && l!.state === 'green', heading: s.heading, reversed: false, mark: null };
      if (!signalled && s.speed > 0) {
        const mine = this.road.rank(from);
        const c = s.junctionConflicts.find(c => c.speed > YIELD_MOVING && c.tta < YIELD_TTA && (c.rank > mine || (c.rank === mine && c.fromRight)));
        if (c) return [violation('vehicleNotYielded', s, { agent: c.agentId })];
      }
    }
    const t = this.transit;
    if (!t) return [];
    if (s.speed < 0) t.reversed = true;
    if (t.green && !t.mark && s.speed > YIELD_MOVING && Math.abs(wrapAngle(s.heading - t.heading)) < LEFT_TURN_COMMIT) {
      const c = s.junctionConflicts.find(c => c.oncoming && (c.turn === 'straight' || c.turn === null) && c.speed > YIELD_MOVING && c.tta < YIELD_TTA);
      if (c) t.mark = { t: s.t, position: s.position, agent: c.agentId };
    }
    return [];
  }

  reset(): void {
    this.approach = null;
    this.light = null;
    this.transit = null;
    this.unjudged = false;
  }
}
