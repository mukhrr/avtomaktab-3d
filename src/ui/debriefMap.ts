import type { Vec2 } from '../shared/district';

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Size { w: number; h: number }
export type Px = [number, number];

/** Marker discs are 20 px across; neighbours closer than this would hide each other's numbers. */
export const MARKER_GAP = 16;
const RINGS = 8;

/** World x east to the right, z south downwards: the minimap's orientation. */
export function project(points: Vec2[], b: Bounds, size: Size): Px[] {
  const sx = size.w / (b.maxX - b.minX), sz = size.h / (b.maxZ - b.minZ);
  return points.map(([x, z]) => [(x - b.minX) * sx, (z - b.minZ) * sz]);
}

/** Box around `points` with `margin` metres on every side, widened on its short axis to the canvas aspect. */
export function fitBounds(points: Vec2[], size: Size, margin: number): Bounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  let w = maxX - minX + 2 * margin, h = maxZ - minZ + 2 * margin;
  const aspect = size.w / size.h;
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - h / 2, maxZ: cz + h / 2 };
}

/** Moves each marker to the nearest free spot on rings around its point, in list order. */
export function markerLayout(points: Px[], gap = MARKER_GAP): Px[] {
  const placed: Px[] = [];
  const free = (p: Px) => placed.every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) >= gap);
  for (const p of points) {
    let spot: Px = p;
    for (let r = 1; !free(spot) && r <= RINGS; r++) {
      const n = 6 * r;
      for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n;
        const c: Px = [p[0] + r * gap * Math.cos(a), p[1] + r * gap * Math.sin(a)];
        if (free(c)) {
          spot = c;
          break;
        }
      }
    }
    placed.push(spot);
  }
  return placed;
}
