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
  toggleLeft: boolean;
  toggleRight: boolean;
  toggleHazard: boolean;
  toggleBelt: boolean;
  /** Held: which mirror the driver is checking, from keys, right stick or mouse look. */
  glance: Glance | null;
}

export type Glance = 'left' | 'rear' | 'right';

export type Gearbox = 'manual' | 'auto';

export interface DrivetrainState {
  gearbox: Gearbox;
  /** -1 reverse, 0 neutral, 1-5. */
  gear: number;
  rpm: number;
  running: boolean;
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
  /** Service brake 0-1. */
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
    // Rolling against the selected gear with the clutch out drags the engine backwards.
    const againstGear = Math.sign(gear) * wheelSpeed < -STANDSTILL;
    if (rpm < STALL_RPM || againstGear) return { state: { ...s, gear, rpm: 0, running: false }, wheelForce: 0, brake: c.brake };
  } else {
    const target = freeRev + (wheelRpmFor(gear, wheelSpeed) - freeRev) * engaged;
    rpm += (target - rpm) * Math.min(1, dt * FREE_REV_RATE);
  }
  if (engaged > 0 && rpm < REDLINE_RPM) wheelForce = forceFor(gear, engineTorque(rpm) * c.throttle * Math.min(1, engaged / LOCKED_ENGAGEMENT));
  return { state: { ...s, gear, rpm, running }, wheelForce, brake: c.brake };
}

function stepAuto(s: DrivetrainState, c: Controls, wheelSpeed: number, _dt: number): DrivetrainStep {
  let gear = s.gear === 0 ? 1 : s.gear;
  // The selector (E/Q) only moves between D and R at a standstill, like a real P-R-N-D lever.
  if (Math.abs(wheelSpeed) < STANDSTILL) {
    if (c.shiftDown && gear >= 1) gear = -1;
    if (c.shiftUp && gear === -1) gear = 1;
  }

  if (gear >= 1) {
    const wheelRpm = wheelRpmFor(gear, wheelSpeed);
    if (gear < 5 && wheelRpm > (c.throttle > FULL_THROTTLE ? UPSHIFT_FULL : UPSHIFT_PART)) gear++;
    else if (gear > 1 && wheelRpm < DOWNSHIFT) gear--;
  }
  const wheelRpm = wheelRpmFor(gear, wheelSpeed);
  // Torque converter: the engine can rev above wheel speed, so it never stalls.
  const rpm = Math.min(REDLINE_RPM, Math.max(wheelRpm, IDLE_RPM + c.throttle * 2200));
  const wheelForce = wheelRpm >= REDLINE_RPM ? 0 : forceFor(gear, engineTorque(rpm) * c.throttle);
  return { state: { ...s, gear, rpm, running: true }, wheelForce, brake: c.brake };
}
