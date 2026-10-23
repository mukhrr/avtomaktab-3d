export interface Controls {
  throttle: number;
  brake: number;
  clutch: number;
  /** -1 full left, +1 full right. */
  steer: number;
  handbrake: boolean;
  shiftUp: boolean;
  shiftDown: boolean;
  ignition: boolean;
}

export type Gearbox = 'manual' | 'auto';

export interface DrivetrainState {
  gearbox: Gearbox;
  /** -1 reverse, 0 neutral, 1-5. */
  gear: number;
  rpm: number;
  running: boolean;
  /** Seconds the brake has been held at a standstill (auto reverse selection). */
  reverseHold?: number;
}

// Chevrolet Cobalt 1.5 (B15D2), approximate figures.
export const IDLE_RPM = 800;
export const REDLINE_RPM = 6200;
const STALL_RPM = 500;
const CUTOFF_RPM = 6500;
const TORQUE_CURVE: [number, number][] = [[800, 95], [2000, 120], [4000, 134], [5600, 128], [6200, 110]];
const GEAR_RATIOS: Record<number, number> = { [-1]: 3.31, 0: 0, 1: 3.58, 2: 2.02, 3: 1.35, 4: 0.98, 5: 0.81 };
const FINAL_DRIVE = 4.18;
export const WHEEL_RADIUS = 0.31;
const EFFICIENCY = 0.85;
const LOCKED_ENGAGEMENT = 0.8;
const SHIFT_CLUTCH = 0.5;
const UPSHIFT_PART = 2600;
const UPSHIFT_FULL = 5500;
const FULL_THROTTLE = 0.9;
const DOWNSHIFT = 1300;
const STANDSTILL = 0.3;
const REVERSE_HOLD_S = 0.4;
const FREE_REV_RATE = 4;

export function engineTorque(rpm: number): number {
  if (rpm > CUTOFF_RPM) return 0;
  if (rpm <= TORQUE_CURVE[0][0]) return TORQUE_CURVE[0][1];
  for (let i = 1; i < TORQUE_CURVE.length; i++) {
    const [r1, t1] = TORQUE_CURVE[i];
    if (rpm <= r1) {
      const [r0, t0] = TORQUE_CURVE[i - 1];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return TORQUE_CURVE.at(-1)![1];
}

const wheelRpmFor = (gear: number, wheelSpeed: number) =>
  ((Math.abs(wheelSpeed) / WHEEL_RADIUS) * GEAR_RATIOS[gear] * FINAL_DRIVE * 60) / (2 * Math.PI);

const forceFor = (gear: number, torque: number) =>
  (Math.sign(gear) * torque * GEAR_RATIOS[gear] * FINAL_DRIVE * EFFICIENCY) / WHEEL_RADIUS;

export interface DrivetrainStep {
  state: DrivetrainState;
  /** Newtons at the contact patches, summed over the driven wheels; negative drives backwards. */
  wheelForce: number;
  /** Service brake 0-1 after auto-reverse pedal swap. */
  brake: number;
}

export function stepDrivetrain(s: DrivetrainState, c: Controls, wheelSpeed: number, dt: number): DrivetrainStep {
  return s.gearbox === 'auto' ? stepAuto(s, c, wheelSpeed, dt) : stepManual(s, c, wheelSpeed, dt);
}

function stepManual(s: DrivetrainState, c: Controls, wheelSpeed: number, dt: number): DrivetrainStep {
  let { gear, rpm, running } = s;
  if (c.clutch >= SHIFT_CLUTCH) {
    if (c.shiftUp && gear < 5) gear++;
    if (c.shiftDown && gear > -1) gear--;
  }
  if (!running) {
    if (c.ignition && (gear === 0 || c.clutch >= LOCKED_ENGAGEMENT)) return { state: { ...s, gear, rpm: IDLE_RPM, running: true }, wheelForce: 0, brake: c.brake };
    return { state: { ...s, gear, rpm: 0 }, wheelForce: 0, brake: c.brake };
  }

  const engaged = gear === 0 ? 0 : 1 - c.clutch;
  const freeRev = IDLE_RPM + c.throttle * (REDLINE_RPM - IDLE_RPM);
  let wheelForce = 0;
  if (engaged > LOCKED_ENGAGEMENT) {
    rpm = wheelRpmFor(gear, wheelSpeed);
    if (rpm < STALL_RPM) return { state: { ...s, gear, rpm: 0, running: false }, wheelForce: 0, brake: c.brake };
  } else {
    const target = freeRev + (wheelRpmFor(gear, wheelSpeed) - freeRev) * engaged;
    rpm += (target - rpm) * Math.min(1, dt * FREE_REV_RATE);
  }
  if (engaged > 0 && rpm < REDLINE_RPM) wheelForce = forceFor(gear, engineTorque(rpm) * c.throttle * Math.min(1, engaged / LOCKED_ENGAGEMENT));
  return { state: { ...s, gear, rpm, running }, wheelForce, brake: c.brake };
}

function stepAuto(s: DrivetrainState, c: Controls, wheelSpeed: number, dt: number): DrivetrainStep {
  let gear = s.gear === 0 ? 1 : s.gear;
  let hold = s.reverseHold ?? 0;
  const stopped = Math.abs(wheelSpeed) < STANDSTILL;

  if (stopped && gear >= 1 && c.brake > 0.5 && c.throttle === 0) {
    hold += dt;
    if (hold >= REVERSE_HOLD_S) { gear = -1; hold = 0; }
  } else hold = 0;
  if (stopped && gear === -1 && c.throttle > 0.5) gear = 1;

  const reverse = gear === -1;
  const throttle = reverse ? c.brake : c.throttle;
  const brake = reverse ? c.throttle : c.brake;

  if (gear >= 1) {
    const wheelRpm = wheelRpmFor(gear, wheelSpeed);
    if (gear < 5 && wheelRpm > (throttle > FULL_THROTTLE ? UPSHIFT_FULL : UPSHIFT_PART)) gear++;
    else if (gear > 1 && wheelRpm < DOWNSHIFT) gear--;
  }
  // Torque converter: the engine can rev above wheel speed, so it never stalls.
  const rpm = Math.min(REDLINE_RPM, Math.max(wheelRpmFor(gear, wheelSpeed), IDLE_RPM + throttle * 2200));
  const wheelForce = forceFor(gear, engineTorque(rpm) * throttle);
  return { state: { ...s, gear, rpm, running: true, reverseHold: hold }, wheelForce, brake };
}
