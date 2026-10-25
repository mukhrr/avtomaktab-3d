import type { LaneRef } from './lanes';

export const POLITENESS = 0.3;
export const THRESHOLD = 0.2;
export const SAFE_BRAKE = -4;
export const TURN_BIAS = 0.6;
/** Seconds the indicator shows before the car starts across. */
export const SIGNAL_TIME = 2.5;
export const CHANGE_TIME = 3;
export const CONSIDER_EVERY = 1.5;
/** A change must be over this far before a lane end or stop line. */
export const CLEAR_OF_END = 30;
export const HARD_BRAKE = -3;
/** Slower than this a car stays in its queue rather than sliding sideways out of it. */
export const MIN_CHANGE_SPEED = 3;
/** Time headway the player keeps from a car changing in ahead of it, and the car from the player ahead. */
export const PLAYER_HEADWAY = 2;
export const LANE_CHANGE_SEED = 1000;

/**
 * `t` runs from -SIGNAL_TIME while the indicator shows to `dur` when the car is in the new lane. With `back` the gap
 * closed before halfway and `t` runs down to 0, the car returning to `from`.
 */
export interface LaneChange {
  from: LaneRef;
  to: LaneRef;
  t: number;
  dur: number;
  back: boolean;
}

export interface FollowerAccel {
  a: number;
  aNew: number;
}

export interface MobilInput {
  a: number;
  aNew: number;
  followerOld: FollowerAccel | null;
  followerNew: FollowerAccel | null;
  bias: number;
}

/** Neither the car nor its new follower would have to brake harder than SAFE_BRAKE. */
export function mobilSafe({ aNew, followerNew }: MobilInput): boolean {
  return aNew >= SAFE_BRAKE && (!followerNew || followerNew.aNew >= SAFE_BRAKE);
}

export function mobil(input: MobilInput): boolean {
  if (!mobilSafe(input)) return false;
  const { a, aNew, followerOld, followerNew, bias } = input;
  const others = (followerNew ? followerNew.aNew - followerNew.a : 0) + (followerOld ? followerOld.aNew - followerOld.a : 0);
  return aNew - a + POLITENESS * others + bias > THRESHOLD;
}

/** Lateral share of the move done at time `t`, eased in and out. */
export function blend(t: number, dur: number): number {
  const x = Math.min(1, Math.max(0, t / dur));
  return x * x * (3 - 2 * x);
}

/** Rate of `blend`, per second. */
export function blendRate(t: number, dur: number): number {
  const x = Math.min(1, Math.max(0, t / dur));
  return (6 * x * (1 - x)) / dur;
}
