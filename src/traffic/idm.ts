export interface DriverParams {
  v0: number;
  a: number;
  b: number;
  T: number;
  s0: number;
}

export const DEFAULT_DRIVER: Omit<DriverParams, 'v0'> = { a: 1.5, b: 2.0, T: 1.4, s0: 2.5 };

const MAX_BRAKE = -9;

export function idmAccel(v: number, gap: number | null, leaderV: number, p: DriverParams): number {
  const free = 1 - (v / p.v0) ** 4;
  let acc: number;
  if (gap === null) {
    acc = p.a * free;
  } else if (gap <= 0) {
    return MAX_BRAKE;
  } else {
    const desired = p.s0 + Math.max(0, v * p.T + (v * (v - leaderV)) / (2 * Math.sqrt(p.a * p.b)));
    acc = p.a * (free - (desired / gap) ** 2);
  }
  return Math.min(p.a, Math.max(MAX_BRAKE, acc));
}

export function canStopBefore(v: number, distance: number, maxDecel = 4): boolean {
  return (v * v) / (2 * distance) <= maxDecel;
}

export function turnSpeed(angleRad: number): number {
  const deg = (Math.abs(angleRad) * 180) / Math.PI;
  if (deg > 60) return 4.5;
  if (deg >= 25) return 8;
  return Infinity;
}
