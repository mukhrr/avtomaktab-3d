import type { Vec2 } from '../shared/district';

const CELL = 40;

/** Uniform grid over bounding boxes; query returns candidates whose box touches the query square. */
export class Grid<T> {
  private cells = new Map<string, T[]>();

  add(minX: number, minZ: number, maxX: number, maxZ: number, item: T): void {
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++)
      for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) {
        const k = `${gx},${gz}`;
        const list = this.cells.get(k);
        if (list) list.push(item);
        else this.cells.set(k, [item]);
      }
  }

  query(x: number, z: number, r: number): Set<T> {
    const out = new Set<T>();
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++)
        for (const item of this.cells.get(`${gx},${gz}`) ?? []) out.add(item);
    return out;
  }
}

export function pointInPolygon(x: number, z: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from point to segment and the parameter t of the closest point. */
export function segmentDistance(x: number, z: number, a: Vec2, b: Vec2): { d: number; t: number } {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return { d: Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t), t };
}
