import type { PenaltyId } from '../penalties';
import type { DriveSnapshot } from '../snapshot';
import { NO_ENTRY_DEDUPE, RED_LIGHT_DEDUPE } from './thresholds';
import type { Rule, Violation } from './types';

interface Suppression { by: PenaltyId; hides: PenaltyId[]; key: string; within: number }

/** One physical mistake seen by two rules is charged once. */
const SUPPRESSIONS: Suppression[] = [
  { by: 'redLight', hides: ['stopLinePast', 'yellowEntry'], key: 'line', within: RED_LIGHT_DEDUPE },
  { by: 'noEntry', hides: ['wrongWayOneway'], key: 'edge', within: NO_ENTRY_DEDUPE },
];
const LONGEST = Math.max(...SUPPRESSIONS.map(x => x.within));

export class RuleEngine {
  private suppressors: Violation[] = [];

  constructor(private readonly rules: Rule[]) {}

  update(s: DriveSnapshot): Violation[] {
    const found = this.rules.flatMap(r => r.update(s));
    for (const v of found) if (SUPPRESSIONS.some(x => x.by === v.id)) this.suppressors.push(v);
    this.suppressors = this.suppressors.filter(v => s.t - v.t <= LONGEST);
    return found.filter(v => !this.hidden(v));
  }

  reset(): void {
    this.suppressors = [];
    for (const r of this.rules) r.reset();
  }

  private hidden(v: Violation): boolean {
    return SUPPRESSIONS.some(x => x.hides.includes(v.id) && this.suppressors.some(p =>
      p.id === x.by && p.detail?.[x.key] !== undefined && p.detail[x.key] === v.detail?.[x.key] && Math.abs(v.t - p.t) <= x.within));
  }
}
