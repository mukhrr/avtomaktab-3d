import * as THREE from 'three';
import type { Landmark } from '../../shared/district';
import { type LandmarkParts, box, limb, merge, paint } from './common';

const GRANITE = 0x5a4f4a, GRANITE_DARK = 0x463d39, STEP = 0x8a8178, BRONZE = 0x6e5230, BRONZE_DARK = 0x54401f, GOLD = 0xb8923a;
const PEDESTAL_TOP = 6.5;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, PEDESTAL_TOP + y, z);

/** The horse walks along +z; the rider's right hand is at -x. */
function horseAndRider(): THREE.BufferGeometry[] {
  const B = BRONZE, D = BRONZE_DARK;
  const parts = [
    limb(v(0, 1.75, -0.95), v(0, 1.8, 0.95), 0.6, B, 10),
    limb(v(0, 1.95, 0.85), v(0, 2.85, 1.4), 0.32, B),
    limb(v(0, 2.85, 1.4), v(0, 2.4, 1.95), 0.2, B),
    limb(v(0, 3.0, 1.3), v(0, 2.3, 0.9), 0.08, D),
    limb(v(0, 1.85, -1.45), v(0, 0.9, -1.75), 0.11, D),
  ];
  for (const x of [-0.3, 0.3]) {
    parts.push(limb(v(x, 1.5, -0.85), v(x, 0.8, -1.05), 0.16, B));
    parts.push(limb(v(x, 0.8, -1.05), v(x, 0, -0.9), 0.11, B));
  }
  parts.push(limb(v(0.3, 1.5, 0.9), v(0.3, 0, 1.0), 0.13, B));
  parts.push(limb(v(-0.3, 1.5, 0.95), v(-0.3, 1.0, 1.45), 0.14, B));
  parts.push(limb(v(-0.3, 1.0, 1.45), v(-0.3, 0.55, 1.3), 0.11, B));

  parts.push(paint(new THREE.CylinderGeometry(0.3, 0.68, 1.2, 10).translate(0, PEDESTAL_TOP + 2.85, -0.2), D));
  parts.push(limb(v(0, 2.35, -0.1), v(0, 3.3, -0.05), 0.3, B));
  parts.push(...[-0.28, 0.28].map(x => limb(v(x, 2.3, 0.1), v(x * 1.6, 1.6, 0.45), 0.12, B)));
  parts.push(paint(new THREE.SphereGeometry(0.22, 10, 8).translate(0, PEDESTAL_TOP + 3.6, 0), B));
  parts.push(paint(new THREE.CylinderGeometry(0.16, 0.22, 0.26, 8).translate(0, PEDESTAL_TOP + 3.97, 0), GOLD));
  parts.push(paint(new THREE.ConeGeometry(0.06, 0.18, 6).translate(0, PEDESTAL_TOP + 4.18, 0), GOLD));
  parts.push(limb(v(-0.32, 3.25, 0), v(-0.62, 4.0, 0.4), 0.1, B));
  parts.push(limb(v(0.32, 3.2, 0), v(0.42, 2.6, 0.35), 0.1, B));
  return parts;
}

export function amirTemurParts(l: Landmark): LandmarkParts {
  const r = l.radius ?? 6;
  const pedestal = [
    paint(new THREE.CylinderGeometry(r * 0.97, r, 0.3, 8).translate(0, 0.15, 0), STEP),
    paint(new THREE.CylinderGeometry(r * 0.82, r * 0.85, 0.3, 8).translate(0, 0.45, 0), STEP),
    box(3.0, 3.7, 4.8, 0, 0.6 + 1.85, 0, GRANITE),
    box(3.3, 0.3, 5.1, 0, 4.45, 0, GRANITE_DARK),
    box(2.5, 1.75, 4.2, 0, 4.6 + 0.875, 0, GRANITE),
    box(2.8, 0.35, 4.5, 0, PEDESTAL_TOP - 0.175, 0, GRANITE_DARK),
    box(1.3, 1.0, 0.06, 0, 2.6, 2.43, BRONZE),
  ];
  return { solid: merge([...pedestal, ...horseAndRider()]) };
}
