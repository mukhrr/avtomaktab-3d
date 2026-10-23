import type { SignType } from '../../shared/district';
import type { Turn } from '../../traffic/turns';
import type { DriveSnapshot } from '../snapshot';
import { ManeuverWatch } from './maneuvers';
import type { RoadInfo } from './road';
import { EPS, FRONT_OFFSET, NO_ENTRY_HOLD, PAST_LINE, STOP_SIGN_WINDOW, STOP_SPEED, WRONG_WAY_HOLD } from './thresholds';
import { violation, type Rule, type Violation } from './types';

const roadKey = (r: { edgeId: string; dir: number }) => `${r.edgeId}|${r.dir}`;
const inside = (s: DriveSnapshot) => s.match.inJunction !== null || s.match.onConnector;

/** The line is the end of the approach lane, where AI traffic stops for the same sign. */
export class StopSignRule implements Rule {
  readonly id = 'noFullStopAtStopSign';
  private approach: { key: string; line: number; past: number; stopped: boolean; judged: boolean } | null = null;

  constructor(private readonly road: RoadInfo) {}

  update(s: DriveSnapshot): Violation[] {
    const ref = s.match.ref;
    if (!ref) {
      this.approach = null;
      return [];
    }
    const key = roadKey(ref);
    if (this.approach?.key !== key) {
      if (inside(s)) return [];
      const stop = this.road.junctionSigns(ref).some(g => g.type === 'stop');
      const line = this.road.laneEnd(ref);
      this.approach = stop ? { key, line, past: this.past(s, line), stopped: false, judged: false } : null;
    }
    const a = this.approach;
    if (!a) return [];
    const past = this.past(s, a.line);
    if (Math.abs(s.speed) < STOP_SPEED && past >= -STOP_SIGN_WINDOW && past <= PAST_LINE) a.stopped = true;
    const crossed = a.past <= PAST_LINE && past > PAST_LINE;
    a.past = past;
    if (!crossed || a.judged) return [];
    a.judged = true;
    return a.stopped ? [] : [violation('noFullStopAtStopSign', s, { edge: key })];
  }

  reset(): void {
    this.approach = null;
  }

  private past(s: DriveSnapshot, line: number): number {
    return (s.match.edgeS - line) * s.match.ref!.dir + FRONT_OFFSET;
  }
}

/** Judged after entry: the new edge must stay matched outside the junction for NO_ENTRY_HOLD. */
export class NoEntryRule implements Rule {
  readonly id = 'noEntry';
  private key: string | null = null;
  private held = 0;
  private charged = false;
  private entered = false;

  constructor(private readonly road: RoadInfo) {}

  update(s: DriveSnapshot): Violation[] {
    const ref = s.match.ref;
    if (!ref || inside(s) || s.speed < 0) return [];
    const key = roadKey(ref);
    if (key !== this.key) {
      this.entered = this.key !== null;
      this.key = key;
      this.held = 0;
      this.charged = false;
    }
    if (!this.entered || this.charged || !this.road.noEntry(ref)) return [];
    this.held += s.dt;
    if (this.held < NO_ENTRY_HOLD - EPS) return [];
    this.charged = true;
    return [violation('noEntry', s, { edge: key })];
  }

  reset(): void {
    this.key = null;
    this.held = 0;
    this.charged = false;
    this.entered = false;
  }
}

const BANNED_BY: Partial<Record<SignType, Turn>> = { noLeftTurn: 'left', noRightTurn: 'right', noUTurn: 'uturn' };

export class TurnRestrictionRule implements Rule {
  readonly id = 'turnRestriction';
  private readonly watch: ManeuverWatch;

  constructor(private readonly road: RoadInfo) {
    this.watch = new ManeuverWatch(road);
  }

  update(s: DriveSnapshot): Violation[] {
    const m = this.watch.update(s);
    if (m?.kind !== 'turn') return [];
    const sign = this.road.junctionSigns(m.from).find(g => BANNED_BY[g.type] === m.turn);
    return sign ? [violation('turnRestriction', s, { sign: sign.type, edge: roadKey(m.from) })] : [];
  }

  reset(): void {
    this.watch.reset();
  }
}

/** Facing against a oneway's only direction while moving forward; reversing with the flow is not judged. */
export class WrongWayOnewayRule implements Rule {
  readonly id = 'wrongWayOneway';
  private key: string | null = null;
  private held = 0;
  private charged = false;

  constructor(private readonly road: RoadInfo) {}

  update(s: DriveSnapshot): Violation[] {
    const ref = s.match.ref;
    if (!ref || inside(s)) return [];
    const key = roadKey(ref);
    if (key !== this.key) {
      this.key = key;
      this.held = 0;
      this.charged = false;
    }
    if (this.charged || this.road.lanes(ref) > 0 || s.speed <= STOP_SPEED) return [];
    this.held += s.dt;
    if (this.held <= WRONG_WAY_HOLD + EPS) return [];
    this.charged = true;
    return [violation('wrongWayOneway', s, { edge: key })];
  }

  reset(): void {
    this.key = null;
    this.held = 0;
    this.charged = false;
  }
}
