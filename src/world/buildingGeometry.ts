import * as THREE from 'three';
import type { Building, BuildingStyle, Vec2 } from '../shared/district';
import { LEVEL_HEIGHT } from '../../tools/city/styles';
import { BAY_WIDTH, FACADE_CELL, FACADE_VARIANT } from './facadeAtlas';
import { pointInPolygon } from './spatial';

const PUBLIC_GROUND_HEIGHT = 4.5;
/** A wall this little taller than its ground floor gets one strip instead of a squashed upper floor. */
const MIN_UPPER = 1;
const PARAPET_INSET = 0.25;
const PARAPET_HEIGHT = 0.6;
/** Narrower than twice this and a roof has no parapet: the ring would leave almost no roof. */
const MIN_ROOF_HALF_WIDTH = 2;
const HIP_HEIGHT = 2;
const HIP_MAX_ASPECT = 3;
const CORNER_MIN_TURN = (12 * Math.PI) / 180;
/** Convex footprint vertices this close to the chord are dropped; the chord then lies inside the footprint. */
const CONVEX_MERGE = 0.15;
const ANY_MERGE = 0.01;
const MAX_MITER = 6;
const BOX_STYLES = new Set<BuildingStyle>(['panel', 'stucco', 'public']);
const BOX_MARGIN = 0.3;
const BOX_TRIES = 12;

const COLOR = { membrane: 0x4b4a48, parapet: 0xbdb7aa, cap: 0xa49e91, box: 0x9c9a94, terracotta: 0xb0583a };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const signedArea = (p: Vec2[]) => p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length];
  return s + a[0] * b[1] - b[0] * a[1];
}, 0) / 2;

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Counter-clockwise footprint without duplicate or near-collinear vertices; never wider than the original. */
export function cleanFootprint(footprint: Vec2[]): Vec2[] {
  let p = signedArea(footprint) < 0 ? [...footprint].reverse() : [...footprint];
  p = p.filter((a, i) => {
    const b = p[(i + 1) % p.length];
    return Math.hypot(b[0] - a[0], b[1] - a[1]) > ANY_MERGE;
  });
  for (;;) {
    if (p.length <= 3) return p;
    let best = -1, bestDev = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 1e-9) continue;
      const turn = cross(a, b, c);
      const dev = Math.abs(turn) / len;
      const limit = turn > 0 ? CONVEX_MERGE : ANY_MERGE;
      if (dev >= limit || dev >= bestDev) continue;
      if (turn > 0 && dev >= ANY_MERGE && p.some((q, k) => k !== i && q !== a && q !== c && inTriangle(q, a, b, c))) continue;
      best = i;
      bestDev = dev;
    }
    if (best < 0) return p;
    p.splice(best, 1);
  }
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Miter offset of every edge `d` metres inward; null when the result would leave the polygon, flip an edge or cross itself. */
export function insetPolygon(poly: Vec2[], d: number): Vec2[] | null {
  const p = signedArea(poly) < 0 ? [...poly].reverse() : poly;
  const n = p.length;
  const normal = (i: number): Vec2 => {
    const a = p[i], b = p[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  };
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const n1 = normal((i + n - 1) % n), n2 = normal(i);
    const denom = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    if (denom < 0.05) return null;
    const mx = (n1[0] + n2[0]) / denom, mz = (n1[1] + n2[1]) / denom;
    if (Math.hypot(mx, mz) > MAX_MITER) return null;
    out.push([p[i][0] + d * mx, p[i][1] + d * mz]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ox = p[j][0] - p[i][0], oz = p[j][1] - p[i][1];
    if (ox * (out[j][0] - out[i][0]) + oz * (out[j][1] - out[i][1]) <= 0) return null;
    if (!pointInPolygon(out[i][0], out[i][1], p)) return null;
    for (let k = 0; k < n; k++) {
      const l = (k + 1) % n;
      if (segmentsCross(out[i], out[j], p[k], p[l])) return null;
      if (k !== i && l !== i && k !== j && segmentsCross(out[i], out[j], out[k], out[l])) return null;
    }
  }
  return out;
}

function upperCell(b: Building): { cell: number; bay: number } {
  const pool = [{ cell: FACADE_CELL[b.style].upper, bay: BAY_WIDTH[b.style] }];
  for (const v of Object.values(FACADE_VARIANT)) if (v.style === b.style && v.use === 'upper') pool.push({ cell: v.cell, bay: v.bay });
  return pool[hash(b.id) % pool.length];
}

/** Walls in two strips per segment: u counts bays along the wall, v counts floors, `facade` is the atlas cell. */
export function wallGeometry(b: Building): THREE.BufferGeometry {
  const poly = cleanFootprint(b.footprint);
  const groundH = b.style === 'public' ? PUBLIC_GROUND_HEIGHT : LEVEL_HEIGHT;
  const twoStrips = b.height > groundH + MIN_UPPER;
  const floors = Math.max(1, Math.round((b.height - groundH) / LEVEL_HEIGHT));
  const cells = FACADE_CELL[b.style];
  const upper = upperCell(b);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], facade: number[] = [], idx: number[] = [];

  const strip = (a: Vec2, c: Vec2, nx: number, nz: number, y0: number, y1: number, u: number, v: number, cell: number) => {
    const base = pos.length / 3;
    pos.push(a[0], y0, a[1], c[0], y0, c[1], c[0], y1, c[1], a[0], y1, a[1]);
    uv.push(u, 0, 0, 0, 0, v, u, v);
    for (let k = 0; k < 4; k++) {
      nor.push(nx, 0, nz);
      facade.push(cell);
    }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const nx = (c[1] - a[1]) / len, nz = -(c[0] - a[0]) / len;
    const plain = b.style === 'shed' || len < BAY_WIDTH[b.style];
    const bays = (bay: number) => (plain ? len / BAY_WIDTH[b.style] : Math.max(1, Math.round(len / bay)));
    if (!twoStrips) {
      strip(a, c, nx, nz, 0, b.height, bays(BAY_WIDTH[b.style]), 1, plain ? cells.plain : cells.ground);
      continue;
    }
    strip(a, c, nx, nz, 0, groundH, bays(BAY_WIDTH[b.style]), 1, plain ? cells.plain : cells.ground);
    strip(a, c, nx, nz, groundH, b.height, bays(plain ? BAY_WIDTH[b.style] : upper.bay), floors, plain ? cells.plain : upper.cell);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('facade', new THREE.Float32BufferAttribute(facade, 1));
  g.setIndex(idx);
  return g;
}

function corners(poly: Vec2[]): Vec2[] {
  const n = poly.length;
  return poly.filter((b, i) => {
    const a = poly[(i + n - 1) % n], c = poly[(i + 1) % n];
    const turn = Math.atan2(cross(a, b, c), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]));
    return Math.abs(turn) >= CORNER_MIN_TURN;
  });
}

function convex(poly: Vec2[]): boolean {
  const n = poly.length;
  return poly.every((b, i) => cross(poly[(i + n - 1) % n], b, poly[(i + 1) % n]) >= 0);
}

/** A pitched roof needs a convex, roughly rectangular footprint; OSM's tag only lifts the brick-only rule. */
export function roofShape(b: Building): 'hipped' | 'flat' {
  const poly = cleanFootprint(b.footprint);
  if (!convex(poly)) return 'flat';
  const q = corners(poly);
  if (q.length !== 4) return 'flat';
  if (b.roof) return 'hipped';
  if (b.style !== 'brick') return 'flat';
  const side = (i: number) => Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1]);
  const p0 = (side(0) + side(2)) / 2, p1 = (side(1) + side(3)) / 2;
  return Math.max(p0, p1) / Math.min(p0, p1) <= HIP_MAX_ASPECT ? 'hipped' : 'flat';
}

class RoofBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  private color = new THREE.Color();

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, hex: number, hint: THREE.Vector3): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) return;
    if (n.dot(hint) < 0) [b, c] = [c, b];
    n.normalize();
    if (n.dot(hint) < 0) n.negate();
    this.color.setHex(hex);
    for (const v of [a, b, c]) {
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(this.color.r, this.color.g, this.color.b);
    }
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, hex: number, hint: THREE.Vector3): void {
    this.tri(a, b, c, hex, hint);
    this.tri(a, c, d, hex, hint);
  }

  /** Vertical band from y0 to y1 along a polygon, facing `side` (1 outward, -1 inward). */
  band(poly: Vec2[], y0: number, y1: number, hex: number, side: 1 | -1): void {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], c = poly[(i + 1) % poly.length];
      const hint = new THREE.Vector3(c[1] - a[1], 0, -(c[0] - a[0])).multiplyScalar(side);
      this.quad(v3(a, y0), v3(c, y0), v3(c, y1), v3(a, y1), hex, hint);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

const v3 = (p: Vec2, y: number) => new THREE.Vector3(p[0], y, p[1]);
const UP = new THREE.Vector3(0, 1, 0);

function hipped(r: RoofBuilder, quad: Vec2[], h: number): void {
  const len = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  // Rotate so q0q1 and q2q3 are the short ends.
  const q = len(quad[0], quad[1]) + len(quad[2], quad[3]) <= len(quad[1], quad[2]) + len(quad[3], quad[0]) ? quad : [quad[1], quad[2], quad[3], quad[0]];
  const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(q[0], q[1]), m2 = mid(q[2], q[3]);
  const ridge = len(m0, m2), w = (len(q[0], q[1]) + len(q[2], q[3])) / 2;
  const t = ridge > w ? w / 2 / ridge : 0.5;
  const at = (k: number): Vec2 => [m0[0] + (m2[0] - m0[0]) * k, m0[1] + (m2[1] - m0[1]) * k];
  const r0 = v3(at(t), h + HIP_HEIGHT), r1 = v3(at(1 - t), h + HIP_HEIGHT);
  const [c0, c1, c2, c3] = q.map(p => v3(p, h));
  const hex = COLOR.terracotta;
  r.tri(c0, c1, r0, hex, UP);
  r.tri(c2, c3, r1, hex, UP);
  r.quad(c1, c2, r1, r0, hex, UP);
  r.quad(c3, c0, r0, r1, hex, UP);
}

function placeBoxes(r: RoofBuilder, poly: Vec2[], inset: Vec2[], h: number, rand: () => number, lift: boolean): void {
  let longest = 0, ax = 1, az = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (l > longest) [longest, ax, az] = [l, (c[0] - a[0]) / l, (c[1] - a[1]) / l];
  }
  const bx = -az, bz = ax;
  const s = inset.map(p => p[0] * ax + p[1] * az), t = inset.map(p => p[0] * bx + p[1] * bz);
  const [s0, s1, t0, t1] = [Math.min(...s), Math.max(...s), Math.min(...t), Math.max(...t)];
  const count = Math.floor(rand() * 4);
  for (let k = 0; k < count; k++) {
    const big = lift && k === 0;
    const [hw, hd, ht] = big ? [1.6, 1.4, 2.4] : [0.6 + rand() * 0.4, 0.4 + rand() * 0.3, 0.7 + rand() * 0.4];
    for (let tries = 0; tries < BOX_TRIES; tries++) {
      const cs = s0 + rand() * (s1 - s0), ct = t0 + rand() * (t1 - t0);
      const at = (ds: number, dt: number): Vec2 => [(cs + ds) * ax + (ct + dt) * bx, (cs + ds) * az + (ct + dt) * bz];
      const m = BOX_MARGIN;
      const check = [at(-hw - m, -hd - m), at(hw + m, -hd - m), at(hw + m, hd + m), at(-hw - m, hd + m)];
      if (!check.every(p => pointInPolygon(p[0], p[1], inset))) continue;
      const crosses = check.some((p, i) => inset.some((q, j) => segmentsCross(p, check[(i + 1) % 4], q, inset[(j + 1) % inset.length])));
      if (crosses) continue;
      const foot = [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)];
      r.band(foot, h, h + ht, COLOR.box, 1);
      const top = foot.map(p => v3(p, h + ht));
      r.quad(top[0], top[1], top[2], top[3], shadeHex(COLOR.box, 1.08), UP);
      break;
    }
  }
}

function shadeHex(hex: number, f: number): number {
  const c = (s: number) => Math.min(255, Math.round(((hex >> s) & 255) * f));
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** Flat membrane with parapet and roof boxes, or a 2 m hipped roof; nothing leaves the footprint. */
export function roofGeometry(b: Building, seed: number): THREE.BufferGeometry {
  const poly = cleanFootprint(b.footprint);
  const h = b.height;
  const r = new RoofBuilder();
  const tris = THREE.ShapeUtils.triangulateShape(poly.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [i, j, k] of tris) r.tri(v3(poly[i], h), v3(poly[j], h), v3(poly[k], h), COLOR.membrane, UP);

  if (roofShape(b) === 'hipped') {
    hipped(r, corners(poly), h);
    return r.geometry();
  }
  if (b.style === 'shed') return r.geometry();
  const inset = insetPolygon(poly, PARAPET_INSET);
  if (!inset || !insetPolygon(poly, MIN_ROOF_HALF_WIDTH)) return r.geometry();
  const top = h + PARAPET_HEIGHT;
  r.band(poly, h, top, COLOR.parapet, 1);
  r.band(inset, h, top, COLOR.parapet, -1);
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    r.quad(v3(poly[i], top), v3(poly[j], top), v3(inset[j], top), v3(inset[i], top), COLOR.cap, UP);
  }
  if (BOX_STYLES.has(b.style)) placeBoxes(r, poly, inset, h, rng(seed ^ hash(b.id)), b.style === 'panel' || b.height > 20);
  return r.geometry();
}
