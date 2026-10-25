import { wrapAngle } from '../traffic/turns';
import type { Controls, Glance } from './drivetrain';

export type Indicator = 'left' | 'right';

export interface CabinState {
  indicator: Indicator | null;
  hazard: boolean;
  belt: boolean;
  glance: Glance | null;
  /** Sim time of the last glance at each mirror, -Infinity if never. */
  lastGlance: Record<Glance, number>;
  /** Car heading when the stalk was last set. */
  setHeading: number;
  /** The car has turned far enough the indicated way since the stalk was set. */
  turned: boolean;
}

// Armed by how far the car has turned, not by the steer input: a keyboard tap goes past any steer threshold and back
// within a lane change, long before the car is in the new lane.
const TURN_ENOUGH = (30 * Math.PI) / 180;
const STRAIGHT = 0.05;

export const newCabin = (): CabinState => ({
  indicator: null,
  hazard: false,
  belt: false,
  glance: null,
  lastGlance: { left: -Infinity, rear: -Infinity, right: -Infinity },
  setHeading: 0,
  turned: false,
});

/** `heading` is the car's (atan2(x, z), falling as it turns right). */
export function stepCabin(s: CabinState, c: Controls, t: number, heading: number): CabinState {
  let { indicator, turned, setHeading } = s;
  if (c.toggleLeft) [indicator, turned, setHeading] = [indicator === 'left' ? null : 'left', false, heading];
  if (c.toggleRight) [indicator, turned, setHeading] = [indicator === 'right' ? null : 'right', false, heading];
  if (indicator) {
    const left = wrapAngle(heading - setHeading);
    if ((indicator === 'left' ? left : -left) > TURN_ENOUGH) turned = true;
    if (turned && Math.abs(c.steer) < STRAIGHT) [indicator, turned] = [null, false];
  }
  const lastGlance = c.glance ? { ...s.lastGlance, [c.glance]: t } : s.lastGlance;
  return {
    indicator,
    hazard: s.hazard !== c.toggleHazard,
    belt: s.belt !== c.toggleBelt,
    glance: c.glance,
    lastGlance,
    setHeading,
    turned,
  };
}

// Matches hud.css `hud-blink` (0.667 s, lit for the first half) and the CarAudio clicks.
const BLINK_PERIOD_S = 0.667;

/** Blink phase shared by the dashboard lamps; restarts whenever the blinking lamp changes, as the HUD animation does. */
export class BlinkClock {
  private key: Indicator | 'hazard' | null = null;
  private phase = 0;

  step(key: Indicator | 'hazard' | null, dt: number): boolean {
    if (key !== this.key) [this.key, this.phase] = [key, 0];
    else this.phase += dt;
    return key !== null && this.phase % BLINK_PERIOD_S < BLINK_PERIOD_S / 2;
  }
}
