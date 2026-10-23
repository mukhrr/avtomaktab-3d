import type { DistrictData, Vec2 } from '../shared/district';
import { rng } from '../sim/rng';
import { Grid, pointInPolygon, segmentDistance } from './spatial';

const AVENUE_KINDS = new Set(['primary', 'secondary', 'tertiary', 'trunk']);
const SPACING = 10;
const CURB_GAP = 3;
const PARK_M2_PER_TREE = 150;
const MAX_PER_AREA = 300;

export function treePositions(d: DistrictData, seed: number): Vec2[] {
  const rand = rng(seed);
  const candidates: Vec2[] = [];

  for (const r of d.roads) {
    if (!AVENUE_KINDS.has(r.kind)) continue;
    const off = r.width / 2 + CURB_GAP;
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let s = 4; s < len - 4; s += SPACING) {
        const x = ax + ((bx - ax) * s) / len, z = az + ((bz - az) * s) / len;
        candidates.push([x + nx * off, z + nz * off], [x - nx * off, z - nz * off]);
      }
    }
  }

  for (const a of d.areas) {
    if (a.kind !== 'green') continue;
    const xs = a.outline.map(p => p[0]), zs = a.outline.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const n = Math.min(Math.floor(((maxX - minX) * (maxZ - minZ)) / PARK_M2_PER_TREE), MAX_PER_AREA);
    for (let k = 0; k < n; k++) {
      const p: Vec2 = [minX + rand() * (maxX - minX), minZ + rand() * (maxZ - minZ)];
      if (pointInPolygon(p[0], p[1], a.outline)) candidates.push(p);
    }
  }

  const roads = new Grid<{ a: Vec2; b: Vec2; half: number }>();
  for (const r of d.roads)
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i], h = r.width / 2;
      roads.add(Math.min(a[0], b[0]) - h, Math.min(a[1], b[1]) - h, Math.max(a[0], b[0]) + h, Math.max(a[1], b[1]) + h, { a, b, half: h });
    }
  const buildings = new Grid<Vec2[]>();
  for (const b of d.buildings) {
    const xs = b.footprint.map(p => p[0]), zs = b.footprint.map(p => p[1]);
    buildings.add(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), b.footprint);
  }

  return candidates.filter(([x, z]) => {
    for (const s of roads.query(x, z, 0)) if (segmentDistance(x, z, s.a, s.b).d <= s.half) return false;
    for (const f of buildings.query(x, z, 0)) if (pointInPolygon(x, z, f)) return false;
    return true;
  });
}
