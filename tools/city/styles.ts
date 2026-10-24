import type { BuildingStyle, Vec2 } from '../../src/shared/district';

export const LEVEL_HEIGHT = 3.2;

const SHED = new Set(['garages', 'garage', 'roof', 'carport', 'guardhouse', 'shed', 'kiosk']);
const PUBLIC = new Set(['university', 'school', 'kindergarten', 'civic', 'museum', 'government', 'hospital', 'public']);

export const levelsFor = (height: number) => Math.max(1, Math.round(height / LEVEL_HEIGHT));

function hull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (input: Vec2[]) => {
    const out: Vec2[] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half(pts.reverse())];
}

/** Sides of the smallest-area rectangle that encloses the points, one edge flush with the convex hull. */
export function minAreaRect(points: Vec2[]): { longSide: number; shortSide: number } {
  const h = hull(points);
  let best = { area: Infinity, w: 0, d: 0 };
  for (let i = 0; i < h.length; i++) {
    const [x0, z0] = h[i], [x1, z1] = h[(i + 1) % h.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len === 0) continue;
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of h) {
      const u = (x - x0) * ux + (z - z0) * uz;
      const v = -(x - x0) * uz + (z - z0) * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const w = maxU - minU, d = maxV - minV;
    if (w * d < best.area) best = { area: w * d, w, d };
  }
  return { longSide: Math.max(best.w, best.d), shortSide: Math.min(best.w, best.d) };
}

export interface ClassifyInput {
  tags: Record<string, string>;
  height: number;
  footprintArea: number;
  longSide: number;
  shortSide: number;
}

export function classifyBuilding({ tags, height, footprintArea, longSide, shortSide }: ClassifyInput): BuildingStyle {
  const kind = tags.building;
  const levels = levelsFor(height);
  if (SHED.has(kind)) return 'shed';
  if (PUBLIC.has(kind) || tags.amenity || tags.office) return 'public';
  if (height >= 40) return 'tower';
  const residential = kind === 'apartments' || kind === 'residential';
  const slab = kind === 'yes' && levels >= 5 && levels <= 16 && longSide / shortSide >= 2.5 && shortSide <= 18;
  if ((residential && levels >= 5) || slab) return 'panel';
  if (levels <= 3 && footprintArea <= 600) return 'brick';
  return 'stucco';
}
