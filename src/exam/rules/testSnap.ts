import type { LaneRef } from '../../traffic/lanes';
import { newCabin, type CabinState } from '../../vehicle/cabin';
import type { LaneMatch } from '../mapMatch';
import type { DriveSnapshot } from '../snapshot';
import type { Rule, Violation } from './types';

export const DT = 0.1;

export type SnapOver = Omit<Partial<DriveSnapshot>, 'match' | 'cabin'> & {
  match?: Partial<LaneMatch>;
  cabin?: Partial<CabinState>;
  ref?: LaneRef | null;
};

export function snap(over: SnapOver = {}): DriveSnapshot {
  const { match, cabin, ref, ...rest } = over;
  return {
    t: 0, dt: DT, position: [0, 0], heading: 0, speed: 0, accel: 0, gear: 1, gearbox: 'manual', running: true,
    cabin: { ...newCabin(), belt: true, ...cabin },
    steer: 0,
    match: {
      ref: ref === undefined ? { edgeId: 'e', dir: 1, lane: 0 } : ref,
      edgeS: 0, lateral: 0, inJunction: null, onConnector: false, confidence: 1, ...match,
    },
    speedLimit: 60, signalAhead: null, crossingsAhead: [], signsAhead: [], leader: null, junctionConflicts: [], events: [],
    ...rest,
  };
}

/** Steps a rule through frames at DT starting from `t0`, returning every violation. */
export function drive(rule: Rule, frames: SnapOver[], t0 = 0): Violation[] {
  return frames.flatMap((f, i) => rule.update(snap({ t: t0 + i * DT, ...f })));
}

export const repeat = (n: number, f: SnapOver | ((i: number) => SnapOver)): SnapOver[] =>
  Array.from({ length: n }, (_, i) => (typeof f === 'function' ? f(i) : f));

export const ids = (vs: Violation[]) => vs.map(v => v.id);
