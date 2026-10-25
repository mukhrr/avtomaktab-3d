import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Crossing, DistrictData, Furniture, GraphEdge, Vec2 } from '../shared/district';
import { FOOT_KINDS } from '../../tools/city/extract';
import { rng } from '../sim/rng';
import { batchChunks, groupByChunk } from './chunks';
import { junctionPolygon, junctionTrim, pointAlong, ribbon } from './roadGeometry';
import { pointInShelter } from '../shared/shelter';
import { inLandmark } from '../shared/landmark';
import { signalPose } from './signals';
import { signPose } from './signs';
import { Grid, pointInPolygon, segmentDistance } from './spatial';
import { TREE_SEED, treePositions } from './vegetation';

const KINDS = new Set(['primary', 'secondary', 'tertiary']);
const ARYK_OFFSET = 1.6;
const ARYK_WIDTH = 0.6;
const MIN_RUN = 6;
const STEP = 0.5;
/** Half of CURB_EXTRA in buildWorld: the kerb strip beyond each carriageway edge. */
const KERB = 0.6;
const JUNCTION_GAP = 1;
const ARYK_CROSSING_GAP = 4;
const FOOTWAY_GAP = 1.5;
const LAMP_SPACING = 32;
const LAMP_OFFSET = 0.8;
const LAMP_ROAD_GAP = 0.5;
const LAMP_CROSSING_GAP = 3;
const POLE_GAP = 2;
const ARYK_GAP = 0.2;
const LAMP_DEDUPE = 6;
const SHELTER_GAP = 0.8;
const LANDMARK_GAP = 1;
const MEDIAN_DEDUPE = 16;
const PAIR_RANGE = 30;
const MIN_MEDIAN = 2;
const PARALLEL = Math.cos((20 * Math.PI) / 180);
const CROSSING_LENGTH = 3;
const CROSSING_PAVEMENT = 3;
export const LAMP_SEED = 11;

export interface Lamp { x: number; z: number; heading: number; double: boolean }

/** A crossing as a strip across the road: centre, unit direction along the road, half sizes along and across. */
export interface CrossingFrame { x: number; z: number; tx: number; tz: number; halfLength: number; halfWidth: number }

export function crossingFrame(c: Crossing, edge: GraphEdge): CrossingFrame {
  const h = pointAlong(edge.points, c.at).heading;
  return { x: c.position[0], z: c.position[1], tx: Math.sin(h), tz: Math.cos(h), halfLength: CROSSING_LENGTH / 2, halfWidth: c.width / 2 + CROSSING_PAVEMENT };
}

function frameGap(f: CrossingFrame, x: number, z: number): number {
  const dx = x - f.x, dz = z - f.z;
  const along = Math.max(Math.abs(dx * f.tx + dz * f.tz) - f.halfLength, 0);
  const across = Math.max(Math.abs(dx * f.tz - dz * f.tx) - f.halfWidth, 0);
  return Math.hypot(along, across);
}

interface Seg { a: Vec2; b: Vec2; half: number }

function segGrid(lines: { points: Vec2[]; width: number }[]): Grid<Seg> {
  const g = new Grid<Seg>();
  for (const l of lines)
    for (let i = 1; i < l.points.length; i++) {
      const a = l.points[i - 1], b = l.points[i], h = l.width / 2;
      g.add(Math.min(a[0], b[0]) - h, Math.min(a[1], b[1]) - h, Math.max(a[0], b[0]) + h, Math.max(a[1], b[1]) + h, { a, b, half: h });
    }
  return g;
}

function boxGrid<T>(items: T[], outline: (t: T) => Vec2[]): Grid<T> {
  const g = new Grid<T>();
  for (const t of items) {
    const o = outline(t), xs = o.map(p => p[0]), zs = o.map(p => p[1]);
    g.add(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), t);
  }
  return g;
}

function polygonGap(poly: Vec2[], x: number, z: number): number {
  if (pointInPolygon(x, z, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, segmentDistance(x, z, poly[j], poly[i]).d);
  return best;
}

interface Context {
  avenues: GraphEdge[];
  carriageways: Grid<Seg>;
  junctions: Grid<Vec2[]>;
  crossings: Grid<CrossingFrame>;
  footways: Grid<Seg>;
  footEnds: Grid<Vec2>;
  buildings: Grid<Vec2[]>;
  shelters: Furniture[];
}

function context(d: DistrictData): Context {
  const edges = new Map(d.graph.edges.map(e => [e.id, e]));
  const kind = new Map(d.roads.map(r => [r.id, r.kind]));
  const polygons = d.graph.nodes.flatMap(n => {
    const touching = n.edges.map(id => edges.get(id)!);
    return junctionTrim(n, touching).size ? [junctionPolygon(n, touching)] : [];
  });
  const frames = d.crossings.flatMap(c => {
    const e = edges.get(c.edgeId);
    return e ? [crossingFrame(c, e)] : [];
  });
  const feet = d.roads.filter(r => FOOT_KINDS.has(r.kind));
  const footEnds = new Grid<Vec2>();
  for (const f of feet) for (const p of [f.points[0], f.points[f.points.length - 1]]) footEnds.add(p[0], p[1], p[0], p[1], p);
  return {
    avenues: d.graph.edges.filter(e => KINDS.has(kind.get(e.roadId) ?? '')),
    carriageways: segGrid(d.graph.edges),
    junctions: boxGrid(polygons, p => p),
    crossings: boxGrid(frames, f => [[f.x - f.halfWidth, f.z - f.halfWidth], [f.x + f.halfWidth, f.z + f.halfWidth]]),
    footways: segGrid(feet),
    footEnds,
    buildings: boxGrid(d.buildings.map(b => b.footprint), f => f),
    shelters: d.furniture.filter(f => f.kind === 'busStop'),
  };
}

/** Metres from the point to the nearest carriageway edge, negative on a carriageway. */
function roadClearance(c: Context, x: number, z: number, r: number): number {
  let best = Infinity;
  for (const s of c.carriageways.query(x, z, r)) best = Math.min(best, segmentDistance(x, z, s.a, s.b).d - s.half);
  return best;
}

function nearJunction(c: Context, x: number, z: number, gap: number): boolean {
  for (const p of c.junctions.query(x, z, gap)) if (polygonGap(p, x, z) < gap) return true;
  return false;
}

function nearCrossing(c: Context, x: number, z: number, gap: number): boolean {
  for (const f of c.crossings.query(x, z, gap)) if (frameGap(f, x, z) < gap) return true;
  return false;
}

function inBuilding(c: Context, x: number, z: number): boolean {
  for (const f of c.buildings.query(x, z, 0)) if (pointInPolygon(x, z, f)) return true;
  return false;
}

function arykBlocked(c: Context, x: number, z: number, tx: number, tz: number): boolean {
  if (c.shelters.some(f => pointInShelter(f, x, z, SHELTER_GAP))) return true;
  if (roadClearance(c, x, z, 20) < KERB + ARYK_WIDTH / 2) return true;
  if (nearJunction(c, x, z, JUNCTION_GAP + ARYK_WIDTH / 2)) return true;
  if (nearCrossing(c, x, z, ARYK_CROSSING_GAP)) return true;
  for (const p of c.footEnds.query(x, z, FOOTWAY_GAP)) if (Math.hypot(p[0] - x, p[1] - z) < FOOTWAY_GAP) return true;
  for (const s of c.footways.query(x, z, FOOTWAY_GAP + 2)) {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], l = Math.hypot(dx, dz) || 1;
    // A pavement running alongside doesn't cut the channel; a path coming in from the side does.
    if (Math.abs((dx * tx + dz * tz) / l) > PARALLEL) continue;
    if (segmentDistance(x, z, s.a, s.b).d < s.half + FOOTWAY_GAP) return true;
  }
  return inBuilding(c, x, z);
}

/** Both kerbside offset lines of an edge, mitred at bends like the road ribbon. */
function offsetLines(points: Vec2[], off: number): Vec2[][] {
  const { positions } = ribbon(points, off * 2);
  const left: Vec2[] = [], right: Vec2[] = [];
  for (let i = 0; i < positions.length; i += 6) {
    left.push([positions[i], positions[i + 2]]);
    right.push([positions[i + 3], positions[i + 5]]);
  }
  return [left, right];
}

type ArykRun = { points: Vec2[]; width: number };
// Render and physics both ask for these; the district object is immutable once loaded.
const arykCache = new WeakMap<DistrictData, ArykRun[]>();
const lampCache = new WeakMap<DistrictData, Map<number, Lamp[]>>();

/** Concrete-edged channels beside the avenues, between the kerb and the tree row. */
export function aryks(d: DistrictData): ArykRun[] {
  const hit = arykCache.get(d);
  if (hit) return hit;
  const out = computeAryks(d);
  arykCache.set(d, out);
  return out;
}

function computeAryks(d: DistrictData): ArykRun[] {
  const c = context(d);
  const out: ArykRun[] = [];
  for (const e of c.avenues) {
    for (const line of offsetLines(e.points, e.width / 2 + ARYK_OFFSET)) {
      let run: Vec2[] = [], runLength = 0, tail: Vec2 | null = null;
      const flush = () => {
        if (tail) run.push(tail);
        if (runLength >= MIN_RUN - 1e-9) out.push({ points: run, width: ARYK_WIDTH });
        run = [];
        runLength = 0;
        tail = null;
      };
      // Samples between vertices only find the gaps; a straight stretch keeps just its ends.
      const visit = (p: Vec2, tx: number, tz: number, vertex: boolean) => {
        if (arykBlocked(c, p[0], p[1], tx, tz)) return flush();
        const last = tail ?? run[run.length - 1];
        if (last) runLength += Math.hypot(p[0] - last[0], p[1] - last[1]);
        if (vertex || !run.length) {
          run.push(p);
          tail = null;
        } else tail = p;
      };
      for (let i = 1; i < line.length; i++) {
        const [ax, az] = line[i - 1], [bx, bz] = line[i];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-6) continue;
        const tx = (bx - ax) / len, tz = (bz - az) / len;
        if (i === 1) visit([ax, az], tx, tz, true);
        for (let s = STEP; s < len; s += STEP) visit([ax + tx * s, az + tz * s], tx, tz, false);
        visit([bx, bz], tx, tz, true);
      }
      flush();
    }
  }
  return out;
}

const oneway = (e: GraphEdge) => e.lanesForward === 0 || e.lanesBackward === 0;

/** The other carriageway of a divided road beside this point: same name, oneway, running the other way. */
function partner(c: Context, e: GraphEdge, x: number, z: number, tx: number, tz: number, byName: Map<string, GraphEdge[]>) {
  if (!oneway(e) || !e.name) return null;
  let best: { q: Vec2; d: number; edge: GraphEdge } | null = null;
  for (const o of byName.get(e.name) ?? []) {
    if (o === e || !oneway(o)) continue;
    for (let i = 1; i < o.points.length; i++) {
      const a = o.points[i - 1], b = o.points[i];
      const { d, t } = segmentDistance(x, z, a, b);
      if (d > PAIR_RANGE || (best && d >= best.d)) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      if ((dx * tx + dz * tz) / l > -PARALLEL) continue;
      const q: Vec2 = [a[0] + dx * t, a[1] + dz * t];
      // Beside, not ahead: the other carriageway lies across this one's direction.
      if (d > 0 && Math.abs(((q[0] - x) * tx + (q[1] - z) * tz) / d) > 0.5) continue;
      best = { q, d, edge: o };
    }
  }
  return best;
}

/**
 * Lamps every 32 m along the avenues. A divided road with a median of 2 m or more gets one double-arm
 * lamp in the median; other roads alternate sides, starting on a side drawn from `seed`.
 */
export function lampPositions(d: DistrictData, seed: number): Lamp[] {
  const bySeed = lampCache.get(d) ?? new Map<number, Lamp[]>();
  lampCache.set(d, bySeed);
  const hit = bySeed.get(seed);
  if (hit) return hit;
  const out = computeLamps(d, seed);
  bySeed.set(seed, out);
  return out;
}

function computeLamps(d: DistrictData, seed: number): Lamp[] {
  const c = context(d);
  const rand = rng(seed);
  const edges = new Map(d.graph.edges.map(e => [e.id, e]));
  const byName = new Map<string, GraphEdge[]>();
  for (const e of c.avenues) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);

  const poles = new Grid<Vec2>();
  const addPole = (x: number, z: number) => poles.add(x, z, x, z, [x, z]);
  for (const [x, z] of treePositions(d, TREE_SEED)) addPole(x, z);
  for (const s of d.signs) {
    const e = edges.get(s.edgeId);
    if (e) { const p = signPose(e, s); addPole(p.x, p.z); }
  }
  for (const s of d.signals) { const p = signalPose(s, edges); addPole(p.x, p.z); }

  const channels = segGrid(aryks(d));
  const placed = new Grid<Lamp>();
  const out: Lamp[] = [];
  const near = (x: number, z: number, r: number, double?: boolean) => {
    for (const l of placed.query(x, z, r)) if ((double === undefined || l.double === double) && Math.hypot(l.x - x, l.z - z) < r) return true;
    return false;
  };
  const free = (x: number, z: number) => {
    if (c.shelters.some(f => pointInShelter(f, x, z, SHELTER_GAP))) return false;
    if (d.landmarks.some(l => inLandmark(l, x, z, LANDMARK_GAP))) return false;
    if (roadClearance(c, x, z, 20) < LAMP_ROAD_GAP) return false;
    if (nearJunction(c, x, z, JUNCTION_GAP) || nearCrossing(c, x, z, LAMP_CROSSING_GAP) || inBuilding(c, x, z)) return false;
    for (const [px, pz] of poles.query(x, z, POLE_GAP)) if (Math.hypot(px - x, pz - z) < POLE_GAP) return false;
    for (const s of channels.query(x, z, 1)) if (segmentDistance(x, z, s.a, s.b).d < s.half + ARYK_GAP) return false;
    return !near(x, z, LAMP_DEDUPE);
  };
  const place = (l: Lamp) => {
    out.push(l);
    placed.add(l.x, l.z, l.x, l.z, l);
  };

  for (const e of c.avenues) {
    const len = e.points.reduce((l, p, i) => (i ? l + Math.hypot(p[0] - e.points[i - 1][0], p[1] - e.points[i - 1][1]) : 0), 0);
    const start = len >= LAMP_SPACING ? (len % LAMP_SPACING) / 2 + LAMP_SPACING / 2 : len / 2;
    const phase = rand() < 0.5 ? 0 : 1;
    if (len < LAMP_SPACING / 2) continue;
    for (let k = 0, s = start; s <= len; k++, s += LAMP_SPACING) {
      const pose = pointAlong(e.points, s);
      const tx = Math.sin(pose.heading), tz = Math.cos(pose.heading);
      const nx = -tz, nz = tx;
      const other = partner(c, e, pose.x, pose.z, tx, tz, byName);
      let side = (k + phase) % 2 ? 1 : -1;
      if (other) {
        const ux = (other.q[0] - pose.x) / other.d, uz = (other.q[1] - pose.z) / other.d;
        const median = other.d - (e.width + other.edge.width) / 2;
        if (median >= MIN_MEDIAN) {
          const off = e.width / 2 + median / 2;
          const x = pose.x + ux * off, z = pose.z + uz * off;
          if (!near(x, z, MEDIAN_DEDUPE, true) && free(x, z)) place({ x, z, heading: Math.atan2(ux, uz), double: true });
          continue;
        }
        side = ux * nx + uz * nz > 0 ? -1 : 1;
      }
      const off = e.width / 2 + LAMP_OFFSET;
      const x = pose.x + nx * off * side, z = pose.z + nz * off * side;
      if (free(x, z)) place({ x, z, heading: Math.atan2(-nx * side, -nz * side), double: false });
    }
  }
  return out;
}

const RIM = new THREE.Color(0xb3ada2), WALL = new THREE.Color(0x8a8478), WATER = new THREE.Color(0x26403e);
const RIM_Y = 0.16, WATER_Y = 0.08, INNER = 0.2;
const H = ARYK_WIDTH / 2;
/** Cross-section from one outer face over the channel to the other; this order makes every face point outward. */
const PROFILE: [Vec2, Vec2, THREE.Color][] = [
  [[-H, 0], [-H, RIM_Y], WALL], [[-H, RIM_Y], [-INNER, RIM_Y], RIM], [[-INNER, RIM_Y], [-INNER, WATER_Y], WALL],
  [[-INNER, WATER_Y], [INNER, WATER_Y], WATER],
  [[INNER, WATER_Y], [INNER, RIM_Y], WALL], [[INNER, RIM_Y], [H, RIM_Y], RIM], [[H, RIM_Y], [H, 0], WALL],
];

export function arykGeometry(points: Vec2[]): THREE.BufferGeometry {
  // A 2 m ribbon's edge vertices sit one mitred unit normal either side of each point.
  const { positions: unit } = ribbon(points, 2);
  const strips = PROFILE.map(([[o1, y1], [o2, y2], colour]) => {
    const pos: number[] = [], idx: number[] = [];
    points.forEach(([x, z], i) => {
      const mx = unit[i * 6] - x, mz = unit[i * 6 + 2] - z;
      pos.push(x + mx * o1, y1, z + mz * o1, x + mx * o2, y2, z + mz * o2);
      if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(pos.flatMap((_, i) => (i % 3 ? [] : [colour.r, colour.g, colour.b])), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
  const merged = mergeGeometries(strips, false);
  strips.forEach(g => g.dispose());
  return merged;
}

export const paint = (g: THREE.BufferGeometry, hex: number) => {
  const c = new THREE.Color(hex);
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
  return g;
};

const POLE = 0x8f9294, HEAD = 0x5d6164, LENS = 0xf2eedf;

/** Arm and head reaching toward +z, curving up from the pole top and out over the road. */
function arm(): THREE.BufferGeometry[] {
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, 8.4, 0), new THREE.Vector3(0, 9.4, 0), new THREE.Vector3(0, 9.6, 0.9), new THREE.Vector3(0, 9.35, 1.8),
  );
  return [
    paint(new THREE.TubeGeometry(curve, 6, 0.05, 4), POLE),
    paint(new THREE.BoxGeometry(0.3, 0.14, 0.7).translate(0, 9.3, 2.05), HEAD),
    paint(new THREE.BoxGeometry(0.22, 0.02, 0.56).translate(0, 9.22, 2.05), LENS),
  ];
}

export function lampGeometry(double: boolean): THREE.BufferGeometry {
  const parts = [
    paint(new THREE.CylinderGeometry(0.07, 0.13, 9, 6, 1, true).translate(0, 4.5, 0), POLE),
    paint(new THREE.CylinderGeometry(0.2, 0.24, 0.6, 6, 1, true).translate(0, 0.3, 0), POLE),
    ...arm(),
    ...(double ? arm().map(g => g.rotateY(Math.PI)) : []),
  ];
  const merged = mergeGeometries(parts.map(g => (g.index ? g.toNonIndexed() : g)), false);
  parts.forEach(g => g.dispose());
  return merged;
}

/** Aryks as one batched mesh of per-chunk geometry, lamps as two instanced meshes (single and double arm). */
export function addStreetside(scene: THREE.Scene, d: DistrictData, chunkSize: number): void {
  const runs = aryks(d);
  if (runs.length) {
    const chunks = [...groupByChunk(runs, r => r.points[0], chunkSize).values()].map(list => {
      const parts = list.map(r => arykGeometry(r.points));
      const g = mergeGeometries(parts, false);
      parts.forEach(p => p.dispose());
      return g;
    });
    const mesh = batchChunks(chunks, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = false;
    scene.add(mesh);
  }

  const lamps = lampPositions(d, LAMP_SEED);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (const double of [false, true]) {
    const own = lamps.filter(l => l.double === double);
    if (!own.length) continue;
    const mesh = new THREE.InstancedMesh(lampGeometry(double), material, own.length);
    own.forEach((l, i) => mesh.setMatrixAt(i, m.compose(p.set(l.x, 0, l.z), q.setFromAxisAngle(up, l.heading), one)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}
