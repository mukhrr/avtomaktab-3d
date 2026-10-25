const DEG = Math.PI / 180;
const OMEGA = 2 * Math.PI * 1.6;
const DAMPING = 0.6;
const SMOOTHING = 0.1;
const PITCH_PER_ACCEL = 0.5 * DEG;
const ROLL_PER_ACCEL = 0.6 * DEG;
const MAX_PITCH = 3 * DEG;
const MAX_ROLL = 4 * DEG;
// Semi-implicit Euler stays close to the analytic response below this step.
const MAX_SUBSTEP = 1 / 120;

const clamp = (x: number, m: number) => Math.max(-m, Math.min(m, x));

class Spring {
  x = 0;
  v = 0;

  step(target: number, max: number, dt: number): number {
    this.v += (OMEGA * OMEGA * (target - this.x) - 2 * DAMPING * OMEGA * this.v) * dt;
    this.x += this.v * dt;
    if (Math.abs(this.x) > max) {
      this.x = Math.sign(this.x) * max;
      this.v = 0;
    }
    return this.x;
  }
}

/**
 * Visual body pitch and roll, in radians, as Euler angles about local +x and +z of a car facing +z.
 * Positive pitch dips the nose; roll leans the roof away from the lateral acceleration.
 */
export class BodyLean {
  private long = 0;
  private lat = 0;
  private pitch = new Spring();
  private roll = new Spring();

  update(longAccel: number, latAccel: number, dt: number): { pitch: number; roll: number } {
    const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / n;
    const k = 1 - Math.exp(-h / SMOOTHING);
    for (let i = 0; i < n; i++) {
      this.long += (longAccel - this.long) * k;
      this.lat += (latAccel - this.lat) * k;
      this.pitch.step(clamp(-this.long * PITCH_PER_ACCEL, MAX_PITCH), MAX_PITCH, h);
      this.roll.step(clamp(this.lat * ROLL_PER_ACCEL, MAX_ROLL), MAX_ROLL, h);
    }
    return { pitch: this.pitch.x, roll: this.roll.x };
  }

  reset(): void {
    this.long = this.lat = 0;
    this.pitch = new Spring();
    this.roll = new Spring();
  }
}
