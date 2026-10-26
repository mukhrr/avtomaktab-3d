import type { DistrictData, Vec2 } from '../shared/district';
import { FOOT_KINDS } from '../../tools/city/extract';

const SIZE = 400;
/** Canvas pixels per metre on the static layer. */
const SCALE = 1.1;

/** Rotating north-up-less minimap: the car always points up. */
export function createMinimap(d: DistrictData) {
  const { minX, maxX, minZ, maxZ } = d.bounds;
  const pad = 200;
  const layer = document.createElement('canvas');
  layer.width = Math.ceil((maxX - minX + pad * 2) * SCALE);
  layer.height = Math.ceil((maxZ - minZ + pad * 2) * SCALE);
  const lx = (x: number) => (x - minX + pad) * SCALE, lz = (z: number) => (z - minZ + pad) * SCALE;

  const g = layer.getContext('2d')!;
  const fill = (pts: [number, number][], colour: string) => {
    g.fillStyle = colour;
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(lx(x), lz(z)) : g.moveTo(lx(x), lz(z))));
    g.fill();
  };
  d.areas.forEach(a => fill(a.outline, a.kind === 'green' ? '#4f6e3a' : '#3d6f8a'));
  d.buildings.forEach(b => fill(b.footprint, '#6d6a64'));
  g.strokeStyle = '#e6e6e6';
  g.lineCap = g.lineJoin = 'round';
  for (const r of d.roads) {
    if (FOOT_KINDS.has(r.kind)) continue;
    g.lineWidth = Math.max(2, r.width * SCALE);
    g.beginPath();
    r.points.forEach(([x, z], i) => (i ? g.lineTo(lx(x), lz(z)) : g.moveTo(lx(x), lz(z))));
    g.stroke();
  }

  const routeLayer = document.createElement('canvas');
  routeLayer.width = layer.width;
  routeLayer.height = layer.height;
  let hasRoute = false;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  return {
    canvas,
    /** The guided route drawn over the roads; null clears it. */
    setRoute(line: Vec2[] | null) {
      const rg = routeLayer.getContext('2d')!;
      rg.clearRect(0, 0, routeLayer.width, routeLayer.height);
      hasRoute = !!line && line.length > 1;
      if (!hasRoute) return;
      rg.strokeStyle = '#3d8bff';
      rg.lineWidth = 6;
      rg.lineCap = rg.lineJoin = 'round';
      rg.beginPath();
      line!.forEach(([x, z], i) => (i ? rg.lineTo(lx(x), lz(z)) : rg.moveTo(lx(x), lz(z))));
      rg.stroke();
    },
    /** heading: radians, 0 = facing +z. */
    draw(x: number, z: number, heading: number) {
      ctx.save();
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#2b2f33';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.translate(SIZE / 2, SIZE / 2);
      ctx.rotate(heading + Math.PI);
      ctx.drawImage(layer, -lx(x), -lz(z));
      if (hasRoute) ctx.drawImage(routeLayer, -lx(x), -lz(z));
      ctx.restore();
      ctx.fillStyle = '#ff4d3a';
      ctx.beginPath();
      ctx.moveTo(SIZE / 2, SIZE / 2 - 14);
      ctx.lineTo(SIZE / 2 + 10, SIZE / 2 + 12);
      ctx.lineTo(SIZE / 2 - 10, SIZE / 2 + 12);
      ctx.fill();
    },
  };
}
