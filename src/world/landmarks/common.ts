import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Landmark, Vec2 } from '../../shared/district';
import { polygonGeometry } from '../meshes';
import { paint } from '../streetside';

export type LandmarkTexture = 'lattice' | 'clock';

/** Geometry in the landmark's local frame: origin at (x, 0, z), +z along heading. */
export interface LandmarkParts {
  solid: THREE.BufferGeometry;
  textured?: { geometry: THREE.BufferGeometry; texture: LandmarkTexture; fallback: number };
  transparent?: THREE.BufferGeometry;
}

export { paint };

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map(p => (p.index ? p.toNonIndexed() : p));
  const g = mergeGeometries(flat, false);
  if (!g) throw new Error('landmark parts have mismatched attributes');
  parts.forEach(p => p.dispose());
  flat.forEach(p => p.dispose());
  return g;
}

/** Inverse of the group's Y rotation by heading, applied after moving the origin to (x, z). */
export function toLocal(l: Landmark, p: Vec2): Vec2 {
  const dx = p[0] - l.x, dz = p[1] - l.z;
  const c = Math.cos(l.heading), s = Math.sin(l.heading);
  return [dx * c - dz * s, dx * s + dz * c];
}

export const signedArea = (p: Vec2[]) => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a[0] * b[1] - b[0] * a[1];
}, 0) / 2;

export const ccw = (p: Vec2[]): Vec2[] => (signedArea(p) < 0 ? [...p].reverse() : [...p]);

export function localFootprint(l: Landmark): Vec2[] {
  if (!l.footprint) throw new Error(`landmark ${l.id} has no footprint`);
  return ccw(l.footprint.map(p => toLocal(l, p)));
}

/** Outward walls of a CCW polygon from y0 to y1; uv in metres divided by tile when given. */
export function walls(poly: Vec2[], y0: number, y1: number, tile?: { u: number; v: number }, closed = true): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  let s = 0;
  for (let i = 0; i < (closed ? poly.length : poly.length - 1); i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const nx = (b[1] - a[1]) / len, nz = -(b[0] - a[0]) / len;
    const quad: [Vec2, number, number][] = [[a, y0, s], [b, y1, s + len], [b, y0, s + len], [a, y0, s], [a, y1, s], [b, y1, s + len]];
    for (const [p, y, u] of quad) {
      pos.push(p[0], y, p[1]);
      nor.push(nx, 0, nz);
      if (tile) uv.push(u / tile.u, y / tile.v);
    }
    s += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (tile) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export const cap = (poly: Vec2[], y: number) => polygonGeometry(poly, y);

/** A cap facing down, for the soffit of anything seen from the street. */
export function underside(poly: Vec2[], y: number): THREE.BufferGeometry {
  const g = polygonGeometry(poly, y).toNonIndexed();
  const pos = g.getAttribute('position') as THREE.BufferAttribute, nor = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 3) {
    const x = pos.getX(i + 1), z = pos.getZ(i + 1);
    pos.setXYZ(i + 1, pos.getX(i + 2), y, pos.getZ(i + 2));
    pos.setXYZ(i + 2, x, y, z);
  }
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, -1, 0);
  return g;
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
}

/** Capsule from a to b; three's capsule runs along +y. */
export function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, hex: number, radial = 8): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, dir.length() - 2 * r), 3, radial);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return paint(g, hex);
}

/** Flat panel facing +z with a semicircular top, for arches painted onto walls. */
export function archPanel(w: number, h: number, hex: number): THREE.BufferGeometry {
  const r = w / 2, shape = new THREE.Shape();
  shape.moveTo(-r, 0);
  shape.lineTo(r, 0);
  shape.lineTo(r, h - r);
  shape.absarc(0, h - r, r, 0, Math.PI, false);
  shape.closePath();
  return paint(new THREE.ShapeGeometry(shape, 6), hex);
}

/** Places a +z-facing part at angle a around the y axis, its face at distance r from it. */
export function aroundY(g: THREE.BufferGeometry, a: number, r: number, y: number): THREE.BufferGeometry {
  return g.translate(0, y, r).rotateY(a);
}
