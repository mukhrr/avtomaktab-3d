import type { Controls, Glance } from './drivetrain';

export type Indicator = 'left' | 'right';

export interface CabinState {
  indicator: Indicator | null;
  hazard: boolean;
  belt: boolean;
  glance: Glance | null;
  /** Sim time of the last glance at each mirror, -Infinity if never. */
  lastGlance: Record<Glance, number>;
  /** The wheel has turned far enough the indicated way since the stalk was set. */
  turned: boolean;
}

const TURN_ENOUGH = 0.25;
const STRAIGHT = 0.05;

export const newCabin = (): CabinState => ({
  indicator: null,
  hazard: false,
  belt: false,
  glance: null,
  lastGlance: { left: -Infinity, rear: -Infinity, right: -Infinity },
  turned: false,
});

/** steerAngle is the front-wheel angle in radians, positive = right. */
export function stepCabin(s: CabinState, c: Controls, steerAngle: number, t: number): CabinState {
  let { indicator, turned } = s;
  if (c.toggleLeft) [indicator, turned] = [indicator === 'left' ? null : 'left', false];
  if (c.toggleRight) [indicator, turned] = [indicator === 'right' ? null : 'right', false];
  if (indicator) {
    const along = indicator === 'right' ? steerAngle : -steerAngle;
    if (along > TURN_ENOUGH) turned = true;
    else if (turned && Math.abs(steerAngle) < STRAIGHT) [indicator, turned] = [null, false];
  }
  const lastGlance = c.glance ? { ...s.lastGlance, [c.glance]: t } : s.lastGlance;
  return {
    indicator,
    hazard: s.hazard !== c.toggleHazard,
    belt: s.belt !== c.toggleBelt,
    glance: c.glance,
    lastGlance,
    turned,
  };
}
