import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_CLASSES, TAXI_SIGN, type CarClass } from './carClasses';

/** Side profile point: z along the car (+z forward), y up. */
type P = [number, number];

interface Spec {
  /** Painted lower body up to the beltline. */
  lower: P[];
  /** Glass greenhouse above the beltline; its top band is painted as the roof. */
  cabin?: P[];
  round?: boolean;
  wheel: number;
  axles: [number, number];
  headY: number;
  tailY: number;
}

const GLASS = 0x26323c;
const TYRE = 0x1b1b1c;
const HUB = 0xa9adb1;
const TRIM = 0x2c2d30;
const HEADLAMP = 0xf4f0dc;
const BUS_BLUE = 0x1f5fb0;
export const BUS_GREEN = 0x2e8b57;

const SPECS: Record<Exclude<CarClass, 'taxi' | 'bus'>, Spec> = {
  spark: {
    lower: [[-1.74, 0.22], [1.74, 0.22], [1.78, 0.52], [1.55, 0.76], [0.9, 0.86], [-1.66, 0.9], [-1.78, 0.62]],
    cabin: [[0.9, 0.86], [0.12, 1.47], [-1.42, 1.5], [-1.7, 0.9]],
    wheel: 0.28, axles: [-1.2, 1.18], headY: 0.68, tailY: 0.82,
  },
  nexia: {
    lower: [[-2.19, 0.22], [2.19, 0.22], [2.23, 0.6], [2.12, 0.76], [0.95, 0.86], [-1.32, 0.9], [-2.17, 0.92], [-2.23, 0.62]],
    cabin: [[0.95, 0.86], [0.18, 1.37], [-0.86, 1.38], [-1.34, 0.9]],
    wheel: 0.3, axles: [-1.3, 1.3], headY: 0.66, tailY: 0.78,
  },
  cobalt: {
    lower: [[-2.19, 0.22], [2.19, 0.22], [2.23, 0.58], [2.1, 0.78], [1.0, 0.9], [-1.16, 0.98], [-2.14, 1.0], [-2.23, 0.68]],
    cabin: [[1.0, 0.9], [0.14, 1.44], [-0.76, 1.45], [-1.2, 0.98]],
    wheel: 0.31, axles: [-1.33, 1.33], headY: 0.68, tailY: 0.86,
  },
  lacetti: {
    lower: [[-2.18, 0.22], [2.18, 0.22], [2.24, 0.52], [2.08, 0.76], [0.95, 0.9], [-1.25, 0.95], [-2.12, 0.96], [-2.24, 0.62]],
    cabin: [[0.98, 0.86], [0.02, 1.47], [-0.62, 1.49], [-1.36, 0.92]],
    round: true, wheel: 0.31, axles: [-1.3, 1.31], headY: 0.68, tailY: 0.82,
  },
  damas: {
    lower: [[-1.7, 0.24], [1.7, 0.24], [1.74, 0.55], [1.62, 0.86], [-1.72, 0.88], [-1.74, 0.5]],
    cabin: [[1.62, 0.86], [1.08, 1.52], [-1.62, 1.54], [-1.72, 0.88]],
    wheel: 0.25, axles: [-1.05, 1.05], headY: 0.68, tailY: 0.78,
  },
};

const BUS: Spec = {
  lower: [[-5.47, 0.3], [5.47, 0.3], [5.5, 1.25], [5.42, 3.02], [-5.44, 3.02], [-5.5, 1.25]],
  wheel: 0.5, axles: [-3.1, 3.4], headY: 0.75, tailY: 1.1,
};

const specOf = (c: CarClass): Spec => (c === 'bus' ? BUS : SPECS[c === 'taxi' ? 'cobalt' : c]);

/** Where the lamp meshes mount on a class: y heights in local space. */
export function lampMounts(c: CarClass): { headY: number; tailY: number } {
  const s = specOf(c);
  return { headY: s.headY, tailY: s.tailY };
}

function chaikin(poly: P[], rounds: number): P[] {
  let pts = poly;
  for (let r = 0; r < rounds; r++) {
    const next: P[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    pts = next;
  }
  return pts;
}

/** The part of a closed polygon at or above y. */
function clipAbove(poly: P[], y: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ain = a[1] >= y, bin = b[1] >= y;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (y - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, y]);
    }
  }
  return out;
}

const finish = (g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry => {
  const flat = g.index ? g.toNonIndexed() : g;
  flat.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = flat.getAttribute('position').count;
  const colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colours.set([c.r, c.g, c.b], i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return flat;
};

/** Extrudes a side profile across the car, width w, centred on x = 0. */
function extrude(poly: P[], w: number, hex: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  return finish(g.rotateY(-Math.PI / 2).translate(w / 2, 0, 0), hex);
}

const box = (w: number, h: number, l: number, x: number, y: number, z: number, hex: number) =>
  finish(new THREE.BoxGeometry(w, h, l).translate(x, y, z), hex);

function wheels(s: Spec, width: number): THREE.BufferGeometry[] {
  const tyreW = s.wheel > 0.4 ? 0.3 : 0.2;
  const out: THREE.BufferGeometry[] = [];
  for (const z of s.axles) for (const side of [-1, 1]) {
    const x = side * (width / 2 - 0.02 - tyreW / 2);
    out.push(finish(new THREE.CylinderGeometry(s.wheel, s.wheel, tyreW, 12).rotateZ(Math.PI / 2).translate(x, s.wheel, z), TYRE));
    out.push(finish(new THREE.CylinderGeometry(s.wheel * 0.55, s.wheel * 0.55, 0.02, 8).rotateZ(Math.PI / 2).translate(side * (width / 2 - 0.01), s.wheel, z), HUB));
  }
  return out;
}

function busParts(width: number, length: number, stripe: number): { paint: THREE.BufferGeometry[]; fixed: THREE.BufferGeometry[] } {
  const h = length / 2;
  const fixed = [
    ...wheels(BUS, width),
    box(width, 1.05, length - 1.0, 0, 1.95, -0.25, GLASS),
    box(width - 0.3, 1.5, 0.04, 0, 2.05, h - 0.03, GLASS),
    box(width - 0.4, 0.6, 0.04, 0, 2.3, -h + 0.03, GLASS),
    box(width, 0.16, length - 0.06, 0, 1.15, 0, stripe),
    box(width, 0.28, 0.1, 0, 0.45, h - 0.05, TRIM),
    box(width, 0.28, 0.1, 0, 0.45, -h + 0.05, TRIM),
    ...[-1, 1].map(x => box(0.3, 0.16, 0.04, x * (width / 2 - 0.3), BUS.headY, h - 0.01, HEADLAMP)),
  ];
  // Doors on the kerb side, which is -x for a car facing +z.
  for (const z of [h - 1.2, -0.4]) fixed.push(box(0.03, 2.55, 1.05, -width / 2 + 0.005, 1.65, z, TRIM));
  return { paint: [extrude(BUS.lower, width - 0.04, 0xffffff)], fixed };
}

/**
 * Model of one traffic class in local space: +z forward, centred on the box, base at y = 0.
 * `paint` is white and takes the paint as instance colour; `fixed` carries its own vertex colours.
 */
export function carGeometry(c: CarClass, busStripe = BUS_BLUE): { paint: THREE.BufferGeometry; fixed: THREE.BufferGeometry } {
  const { length, width } = CAR_CLASSES[c];
  const s = specOf(c);
  let parts: { paint: THREE.BufferGeometry[]; fixed: THREE.BufferGeometry[] };
  if (c === 'bus') parts = busParts(width, length, busStripe);
  else {
    const h = length / 2;
    const lower = s.round ? chaikin(s.lower, 2) : s.lower;
    const cabin = s.round ? chaikin(s.cabin!, 2) : s.cabin!;
    const top = Math.max(...cabin.map(p => p[1]));
    const cabinW = width * 0.84;
    parts = {
      paint: [extrude(lower, width - 0.06, 0xffffff), extrude(clipAbove(cabin, top - 0.05), cabinW + 0.02, 0xffffff)],
      fixed: [
        extrude(cabin, cabinW, GLASS),
        ...wheels(s, width),
        box(width - 0.02, 0.2, 0.1, 0, 0.36, h - 0.05, TRIM),
        box(width - 0.02, 0.2, 0.1, 0, 0.36, -h + 0.05, TRIM),
        box(width * 0.4, 0.1, 0.03, 0, s.headY - 0.02, h - 0.02, TRIM),
        ...[-1, 1].map(x => box(0.28, 0.13, 0.04, x * (width / 2 - 0.24), s.headY, h - 0.02, HEADLAMP)),
      ],
    };
    if (c === 'taxi') parts.fixed.push(box(0.5, 0.13, 0.26, 0, top + 0.065, -0.3, TAXI_SIGN));
  }
  const paint = mergeGeometries(parts.paint)!;
  const fixed = mergeGeometries(parts.fixed)!;
  for (const g of [...parts.paint, ...parts.fixed]) g.dispose();
  return { paint, fixed };
}
