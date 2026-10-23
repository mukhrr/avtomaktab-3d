import type { Controls } from './drivetrain';

const STEER_IN = 3;
const STEER_OUT = 5;
const CLUTCH_RELEASE = 1.5;
const DEADZONE = 0.08;

// Standard gamepad mapping.
const PAD = { throttle: 7, brake: 6, clutch: 4, handbrake: 5, shiftUp: 3, shiftDown: 2, ignition: 9 } as const;

const any = (held: ReadonlySet<string>, ...codes: string[]) => codes.some(c => held.has(c));

/** Turns raw keyboard and gamepad state into smoothed driving controls; keeps edge and ramp state between frames. */
export class InputReader {
  private steer = 0;
  private clutch = 0;
  private padHeld = new Set<number>();

  read(held: ReadonlySet<string>, pressed: ReadonlySet<string>, pads: readonly (Gamepad | null)[], dt: number): Controls {
    const pad = pads.find((p): p is Gamepad => !!p) ?? null;
    const btn = (i: number) => pad?.buttons[i]?.value ?? 0;
    const padEdge = (i: number) => {
      const down = btn(i) > 0.5, was = this.padHeld.has(i);
      if (down) this.padHeld.add(i); else this.padHeld.delete(i);
      return down && !was;
    };
    if (!pad) this.padHeld.clear();

    const keySteer = (any(held, 'KeyD', 'ArrowRight') ? 1 : 0) - (any(held, 'KeyA', 'ArrowLeft') ? 1 : 0);
    const rate = keySteer !== 0 && Math.sign(keySteer) !== -Math.sign(this.steer) ? STEER_IN : STEER_OUT;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, keySteer - this.steer));
    const axis = pad?.axes[0] ?? 0;
    const steer = Math.abs(axis) > DEADZONE ? axis : this.steer;

    const keyClutch = any(held, 'ShiftLeft', 'ShiftRight');
    this.clutch = keyClutch ? 1 : Math.max(0, this.clutch - CLUTCH_RELEASE * dt);
    const padClutch = btn(PAD.clutch);

    const keyOr = (padValue: number, keyValue: number) => (padValue > 0 ? padValue : keyValue);
    return {
      throttle: keyOr(btn(PAD.throttle), any(held, 'KeyW', 'ArrowUp') ? 1 : 0),
      brake: keyOr(btn(PAD.brake), any(held, 'KeyS', 'ArrowDown') ? 1 : 0),
      clutch: keyOr(padClutch, this.clutch),
      steer,
      handbrake: btn(PAD.handbrake) > 0.5 || held.has('Space'),
      shiftUp: padEdge(PAD.shiftUp) || pressed.has('KeyE'),
      shiftDown: padEdge(PAD.shiftDown) || pressed.has('KeyQ'),
      ignition: padEdge(PAD.ignition) || pressed.has('KeyI'),
    };
  }
}
