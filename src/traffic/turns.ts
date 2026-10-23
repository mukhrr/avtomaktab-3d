import type { Vec2 } from '../shared/district';
import type { LaneNetwork, LaneRef } from './lanes';

export type Turn = 'straight' | 'left' | 'right' | 'uturn';

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function classifyTurn(fromHeading: number, toHeading: number): Turn {
  const delta = wrapAngle(toHeading - fromHeading);
  const abs = Math.abs(delta);
  if (abs < Math.PI / 6) return 'straight';
  if (abs > (5 * Math.PI) / 6) return 'uturn';
  // Heading is atan2(dx, dz) with x east and z south, so turning right decreases it.
  return delta < 0 ? 'right' : 'left';
}

/** Distance along a polyline to the point closest to `p`. */
export function project(points: Vec2[], p: Vec2): number {
  let best = Infinity, at = 0, run = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (len * len))) : 0;
    const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
    if (d < best) {
      best = d;
      at = run + t * len;
    }
    run += len;
  }
  return at;
}

export const endHeading = (pts: Vec2[]) => {
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  return Math.atan2(b[0] - a[0], b[1] - a[1]);
};
export const startHeading = (pts: Vec2[]) => Math.atan2(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);

export function turnBetween(net: LaneNetwork, from: LaneRef, to: LaneRef): Turn {
  return classifyTurn(endHeading(net.path(from).points), startHeading(net.path(to).points));
}
