import * as THREE from 'three';
import { BodyLean } from './bodyLean';

const DEG = Math.PI / 180;
const DT = 1 / 60;

function run(lean: BodyLean, long: number, lat: number, seconds: number) {
  let out = { pitch: 0, roll: 0 };
  for (let i = 0; i < Math.round(seconds / DT); i++) out = lean.update(long, lat, DT);
  return out;
}

const tilt = (o: { pitch: number; roll: number }, v: THREE.Vector3) =>
  v.applyEuler(new THREE.Euler(o.pitch, 0, o.roll));

describe('body lean', () => {
  it('steady braking at -5 m/s^2 settles to a 2.5 degree nose-down pitch', () => {
    const out = run(new BodyLean(), -5, 0, 4);
    expect(out.pitch / DEG).toBeCloseTo(2.5, 2);
    expect(tilt(out, new THREE.Vector3(0, 0, 1)).y).toBeLessThan(0);
  });

  it('steady cornering at 6 m/s^2 settles to a 3.6 degree roll toward the outside', () => {
    const out = run(new BodyLean(), 0, 6, 4);
    expect(Math.abs(out.roll) / DEG).toBeCloseTo(3.6, 2);
    // Pushed toward +x, so the roof leans out to -x.
    expect(tilt(out, new THREE.Vector3(0, 1, 0)).x).toBeLessThan(0);
    const other = run(new BodyLean(), 0, -6, 4);
    expect(tilt(other, new THREE.Vector3(0, 1, 0)).x).toBeGreaterThan(0);
  });

  it('clamps 15 m/s^2 to 3 degrees of pitch and 4 of roll at every step', () => {
    const lean = new BodyLean();
    let maxPitch = 0, maxRoll = 0;
    for (let i = 0; i < 240; i++) {
      const o = lean.update(-15, 15, DT);
      maxPitch = Math.max(maxPitch, Math.abs(o.pitch));
      maxRoll = Math.max(maxRoll, Math.abs(o.roll));
    }
    expect(maxPitch / DEG).toBeCloseTo(3, 3);
    expect(maxRoll / DEG).toBeCloseTo(4, 3);
    const accel = run(new BodyLean(), 15, -15, 4);
    expect(accel.pitch / DEG).toBeCloseTo(-3, 3);
    expect(accel.roll / DEG).toBeCloseTo(-4, 3);
  });

  it('reset returns to zero immediately and forgets the motion', () => {
    const lean = new BodyLean();
    run(lean, -5, 6, 1);
    lean.reset();
    const out = lean.update(0, 0, DT);
    expect(Math.abs(out.pitch)).toBeLessThan(1e-9);
    expect(Math.abs(out.roll)).toBeLessThan(1e-9);
  });

  it('a step input overshoots by at most 15 percent, and does overshoot a little', () => {
    const lean = new BodyLean();
    let peak = 0;
    for (let i = 0; i < 240; i++) peak = Math.max(peak, lean.update(-4, 0, DT).pitch);
    const target = 2 * DEG;
    expect(peak).toBeLessThanOrEqual(target * 1.15);
    expect(peak).toBeGreaterThan(target * 1.01);
  });

  it('gives the same answer for one long frame as for small steps', () => {
    const a = run(new BodyLean(), -3, 2, 1);
    const b = new BodyLean();
    let out = { pitch: 0, roll: 0 };
    for (let i = 0; i < 20; i++) out = b.update(-3, 2, 0.05);
    expect(out.pitch).toBeCloseTo(a.pitch, 3);
    expect(out.roll).toBeCloseTo(a.roll, 3);
  });
});
