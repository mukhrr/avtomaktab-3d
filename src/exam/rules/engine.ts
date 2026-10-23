import type { PenaltyId } from '../penalties';
import type { DriveSnapshot } from '../snapshot';
import { COLLISION_DEDUPE, NO_ENTRY_DEDUPE, RED_LIGHT_DEDUPE } from './thresholds';
import type { Rule, Violation } from './types';

interface Suppression {
  by: PenaltyId;
  hides: PenaltyId[];
  /** Detail field both must share; null when GameEvent gives nothing to match on. */
  key: string | null;
  within: number;
  /** Hidden ids are held back for `within` so a suppressor arriving later still removes them. */
  hold: boolean;
}

/** One physical mistake seen by two rules is charged once. */
const SUPPRESSIONS: Suppression[] = [
  { by: 'redLight', hides: ['stopLinePast', 'yellowEntry'], key: 'line', within: RED_LIGHT_DEDUPE, hold: true },
  // Not held: wrongWayOneway is a fail and always comes after noEntry, so delaying it would only delay the fail.
  { by: 'noEntry', hides: ['wrongWayOneway'], key: 'edge', within: NO_ENTRY_DEDUPE, hold: false },
  { by: 'pedestrianNotYielded', hides: ['collisionPedestrian'], key: null, within: COLLISION_DEDUPE, hold: false },
  { by: 'vehicleNotYielded', hides: ['collisionCar'], key: null, within: COLLISION_DEDUPE, hold: false },
];
const LONGEST = Math.max(...SUPPRESSIONS.map(x => x.within));

export class RuleEngine {
  private suppressors: Violation[] = [];
  private held: Violation[] = [];

  constructor(private readonly rules: Rule[]) {}

  /** Same-line stopLinePast and yellowEntry come out up to RED_LIGHT_DEDUPE late, keeping their own t and position. */
  update(s: DriveSnapshot): Violation[] {
    const found = this.rules.flatMap(r => r.update(s));
    for (const v of found) if (SUPPRESSIONS.some(x => x.by === v.id)) this.suppressors.push(v);
    this.suppressors = this.suppressors.filter(v => s.t - v.t <= LONGEST);
    this.held = this.held.filter(v => !this.hidden(v));
    const out: Violation[] = [];
    for (const v of found) {
      if (this.hidden(v)) continue;
      if (this.holdFor(v) > 0) this.held.push(v);
      else out.push(v);
    }
    const due = this.held.filter(v => s.t - v.t > this.holdFor(v));
    this.held = this.held.filter(v => !due.includes(v));
    return [...due, ...out];
  }

  /** Violations still held back, for when the drive ends. */
  flush(): Violation[] {
    const held = this.held;
    this.held = [];
    return held;
  }

  reset(): void {
    this.suppressors = [];
    this.held = [];
    for (const r of this.rules) r.reset();
  }

  private holdFor(v: Violation): number {
    return Math.max(0, ...SUPPRESSIONS.filter(x => x.hold && x.hides.includes(v.id) && (x.key === null || v.detail?.[x.key] !== undefined)).map(x => x.within));
  }

  private hidden(v: Violation): boolean {
    return SUPPRESSIONS.some(x => x.hides.includes(v.id) && this.suppressors.some(p => p.id === x.by && Math.abs(v.t - p.t) <= x.within
      && (x.key === null || (p.detail?.[x.key] !== undefined && p.detail[x.key] === v.detail?.[x.key]))));
  }
}
