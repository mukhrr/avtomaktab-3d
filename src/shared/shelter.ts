import type { Furniture, Vec2 } from './district';

export const SHELTER_LENGTH = 4;
export const SHELTER_DEPTH = 1.6;
export const SHELTER_HEIGHT = 2.5;

/** Corners of the shelter's ground box, grown by `margin` on every side. Local +x runs along the shelter, +z toward the road. */
export function shelterCorners(f: Pick<Furniture, 'x' | 'z' | 'heading'>, margin: number): Vec2[] {
  const ax = Math.cos(f.heading), az = -Math.sin(f.heading), fx = Math.sin(f.heading), fz = Math.cos(f.heading);
  const hl = SHELTER_LENGTH / 2 + margin, hd = SHELTER_DEPTH / 2 + margin;
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Vec2[]).map(([u, v]) => [f.x + ax * u * hl + fx * v * hd, f.z + az * u * hl + fz * v * hd]);
}

export function pointInShelter(f: Pick<Furniture, 'x' | 'z' | 'heading'>, x: number, z: number, margin: number): boolean {
  const dx = x - f.x, dz = z - f.z;
  const u = dx * Math.cos(f.heading) - dz * Math.sin(f.heading), v = dx * Math.sin(f.heading) + dz * Math.cos(f.heading);
  return Math.abs(u) <= SHELTER_LENGTH / 2 + margin && Math.abs(v) <= SHELTER_DEPTH / 2 + margin;
}
