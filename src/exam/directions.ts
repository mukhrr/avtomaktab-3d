import type { Maneuver } from './route';

export interface Prompt {
  key: string;
  vars?: Record<string, string | number>;
}

export const AHEAD_M = 50;
export const NOW_M = 15;

const AHEAD: Partial<Record<Maneuver, string>> = {
  left: 'exam.turnLeftAhead', right: 'exam.turnRightAhead', straight: 'exam.straight', uturn: 'exam.uturn', finish: 'exam.finishAhead',
};
const NOW: Partial<Record<Maneuver, string>> = { left: 'exam.turnLeftNow', right: 'exam.turnRightNow', finish: 'exam.stopHere' };

/** Announces one maneuver as the car closes on it; make a new one for each route step. */
export class DirectionTracker {
  private given: 0 | 1 | 2 = 0;

  /** `distance` is metres to the maneuver along the current lane, negative once it is behind. */
  update(distance: number, maneuver: Maneuver, signalled: boolean): Prompt[] {
    if (distance < 0) return [];
    const out: Prompt[] = [];
    if (this.given < 1 && distance <= AHEAD_M && distance > NOW_M) {
      this.given = 1;
      if (AHEAD[maneuver] && (maneuver !== 'straight' || signalled)) out.push({ key: AHEAD[maneuver]! });
    }
    if (this.given < 2 && distance <= NOW_M) {
      this.given = 2;
      if (NOW[maneuver]) out.push({ key: NOW[maneuver]! });
    }
    return out;
  }
}
