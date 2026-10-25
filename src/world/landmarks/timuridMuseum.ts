import * as THREE from 'three';
import type { Landmark, Vec2 } from '../../shared/district';
import { pointInPolygon, segmentDistance } from '../spatial';
import { type LandmarkParts, archPanel, aroundY, localFootprint, merge, paint } from './common';

const DRUM_H = 8;
const DOME_TOP = 20;
const INNER_DRUM = 2;
const MARGIN = 0.5;
const SEGMENTS = 96;
const RIBS = 24;
const WINDOWS = 28;
const STONE = 0xe9e3d6, CORNICE = 0xd6cdb8, RECESS = 0x3b4a5a, BLUE = 0x2a6fa8, RIB = 0x8fc0dd, GOLD = 0xc9a23f;

const edgeGap = (p: Vec2[], x: number, z: number) =>
  p.reduce((m, a, i) => Math.min(m, segmentDistance(x, z, a, p[(i + 1) % p.length]).d), Infinity);

/** Largest inscribed circle by a coarse grid then a fine one around the best cell. */
export function inscribedCircle(p: Vec2[]): { x: number; z: number; r: number } {
  const xs = p.map(q => q[0]), zs = p.map(q => q[1]);
  let best = { x: 0, z: 0, r: -Infinity };
  const search = (x0: number, x1: number, z0: number, z1: number, steps: number) => {
    for (let i = 0; i <= steps; i++)
      for (let j = 0; j <= steps; j++) {
        const x = x0 + ((x1 - x0) * i) / steps, z = z0 + ((z1 - z0) * j) / steps;
        if (!pointInPolygon(x, z, p)) continue;
        const r = edgeGap(p, x, z);
        if (r > best.r) best = { x, z, r };
      }
  };
  search(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), 40);
  const cell = (Math.max(...xs) - Math.min(...xs)) / 40;
  search(best.x - cell, best.x + cell, best.z - cell, best.z + cell, 20);
  return best;
}

function ribbedDome(r: number, y0: number, h: number): THREE.BufferGeometry {
  const profile = Array.from({ length: 17 }, (_, i) => {
    const t = (i / 16) * (Math.PI / 2);
    return new THREE.Vector2(Math.max(0.001, r * Math.cos(t)), y0 + h * Math.sin(t));
  });
  const g = new THREE.LatheGeometry(profile, SEGMENTS).toNonIndexed();
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const blue = new THREE.Color(BLUE), rib = new THREE.Color(RIB), c = new THREE.Color();
  const col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const k = Math.pow(Math.abs(Math.cos((Math.atan2(x, z) * RIBS) / 2)), 12);
    pos.setXYZ(i, x * (1 + 0.012 * k), pos.getY(i), z * (1 + 0.012 * k));
    c.copy(blue).lerp(rib, k * 0.8);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function timuridMuseumParts(l: Landmark): LandmarkParts {
  const c = inscribedCircle(localFootprint(l));
  const r = c.r - MARGIN;
  const domeR = r * 0.56;
  const parts = [
    paint(new THREE.CylinderGeometry(r, r, DRUM_H - 0.6, SEGMENTS / 2, 1, true).translate(0, (DRUM_H - 0.6) / 2, 0), STONE),
    paint(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 0.6, SEGMENTS / 2, 1, true).translate(0, DRUM_H - 0.3, 0), CORNICE),
    paint(new THREE.RingGeometry(domeR, r + 0.3, SEGMENTS / 2, 1).rotateX(-Math.PI / 2).translate(0, DRUM_H, 0), CORNICE),
    paint(new THREE.CylinderGeometry(domeR, domeR, INNER_DRUM, SEGMENTS / 2, 1, true).translate(0, DRUM_H + INNER_DRUM / 2, 0), STONE),
    paint(new THREE.CylinderGeometry(domeR + 0.25, domeR + 0.25, 0.4, SEGMENTS / 2, 1, true).translate(0, DRUM_H + INNER_DRUM - 0.2, 0), CORNICE),
    ribbedDome(domeR, DRUM_H + INNER_DRUM, DOME_TOP - DRUM_H - INNER_DRUM - 0.9),
    paint(new THREE.SphereGeometry(0.45, 8, 6).translate(0, DOME_TOP - 0.7, 0), GOLD),
    paint(new THREE.ConeGeometry(0.15, 0.9, 6).translate(0, DOME_TOP - 0.45, 0), GOLD),
  ];
  for (let i = 0; i < WINDOWS; i++)
    parts.push(aroundY(archPanel(2.0, 4.6, RECESS), (i / WINDOWS) * Math.PI * 2, r + 0.05, 1.6));
  return { solid: merge(parts).translate(c.x, 0, c.z) };
}
