import type { LightState } from '../../sim/signals';
import { canStopBefore } from '../../traffic/idm';
import type { DriveSnapshot } from '../snapshot';
import { EPS, FRONT_OFFSET, PAST_LINE, STOP_LINE_PAST_HOLD, STOP_SPEED, YELLOW_MAX_DECEL } from './thresholds';
import { violation, type Rule, type Violation } from './types';

interface Line {
  key: string;
  edgeId: string;
  dir: 1 | -1;
  stopAt: number;
  /** Last state seen; frozen once the centre is past the line, where the snapshot stops reporting it. */
  state: LightState;
  /** Whether a stop was possible at the yellow onset, null before any yellow. */
  couldStop: boolean | null;
  /** Front bumper past the line, metres. */
  past: number;
}

/** Remembers the current approach's stop line after the snapshot stops listing it. */
class LineWatch {
  line: Line | null = null;
  /** Set on the step the front goes more than PAST_LINE over, with the light at that moment. */
  crossed: LightState | null = null;

  update(s: DriveSnapshot): void {
    const ref = s.match.ref;
    const seen = s.signalAhead;
    this.crossed = null;
    if (this.line && (!ref || ref.edgeId !== this.line.edgeId || ref.dir !== this.line.dir)) this.line = null;
    if (!ref) return;
    const past = (stopAt: number) => (s.match.edgeS - stopAt) * ref.dir + FRONT_OFFSET;
    if (seen) {
      const key = `${ref.edgeId}|${ref.dir}|${Math.round(seen.stopAt * 10) / 10}`;
      if (this.line?.key !== key) {
        this.line = { key, edgeId: ref.edgeId, dir: ref.dir, stopAt: seen.stopAt, state: seen.state, couldStop: null, past: past(seen.stopAt) };
      }
      if (seen.state === 'yellow' && this.line.couldStop === null) this.line.couldStop = couldStop(s.speed, seen.distance);
      if (seen.state !== 'yellow') this.line.couldStop = null;
      this.line.state = seen.state;
    }
    const line = this.line;
    if (!line) return;
    const now = past(line.stopAt);
    if (line.past <= PAST_LINE && now > PAST_LINE) this.crossed = line.state;
    line.past = now;
  }

  reset(): void {
    this.line = null;
    this.crossed = null;
  }
}

function couldStop(speed: number, centreToLine: number): boolean {
  const front = centreToLine - FRONT_OFFSET;
  return front > 0 && canStopBefore(Math.abs(speed), front, YELLOW_MAX_DECEL);
}

abstract class LineRule implements Rule {
  abstract readonly id: string;
  protected readonly watch = new LineWatch();
  private charged: Line | null = null;

  update(s: DriveSnapshot): Violation[] {
    this.watch.update(s);
    const line = this.watch.line;
    const id = line && this.charged !== line ? this.judge(s, line) : null;
    if (!id || !line) return [];
    this.charged = line;
    return [violation(id, s, { line: line.key })];
  }

  reset(): void {
    this.watch.reset();
    this.charged = null;
  }

  protected abstract judge(s: DriveSnapshot, line: Line): 'redLight' | 'yellowEntry' | 'stopLinePast' | null;
}

export class RedLightRule extends LineRule {
  readonly id = 'redLight';
  protected judge(): 'redLight' | null {
    return this.watch.crossed === 'red' || this.watch.crossed === 'redYellow' ? 'redLight' : null;
  }
}

/** Never charged when a stop was impossible at the yellow onset (YHQ 42). */
export class YellowEntryRule extends LineRule {
  readonly id = 'yellowEntry';
  protected judge(_s: DriveSnapshot, line: Line): 'yellowEntry' | null {
    return this.watch.crossed === 'yellow' && line.couldStop === true ? 'yellowEntry' : null;
  }
}

export class StopLinePastRule extends LineRule {
  readonly id = 'stopLinePast';
  private still = 0;

  update(s: DriveSnapshot): Violation[] {
    this.still = Math.abs(s.speed) < STOP_SPEED ? this.still + s.dt : 0;
    return super.update(s);
  }

  reset(): void {
    super.reset();
    this.still = 0;
  }

  protected judge(_s: DriveSnapshot, line: Line): 'stopLinePast' | null {
    return line.state === 'red' && line.past > PAST_LINE && this.still >= STOP_LINE_PAST_HOLD - EPS ? 'stopLinePast' : null;
  }
}
