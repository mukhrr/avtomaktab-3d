import * as THREE from 'three';
import type { Landmark, Vec2 } from '../../shared/district';
import { pointInPolygon } from '../spatial';
import { type LandmarkParts, archPanel, aroundY, box, cap, localFootprint, merge, paint, toLocal, walls } from './common';

const BASE = 6;
const TOWER_HALF = 2;
const TOWER_TOP = 26;
const CLOCK_Y0 = 18, CLOCK_Y1 = 22;
const CLOCK_HALF = 2.3;
const FACE = 3.2;
const SPIRE_TOP = 32;
const WHITE = 0xf0ece2, CREAM = 0xe2d9c4, SHADOW = 0x3c3a38, ROOF = 0x8d8a83, GREEN = 0x5d7f73, GOLD = 0xc9a23f;

const sides = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/** The anchor in local space, pulled toward the origin until the tower's base corners sit inside the footprint. */
export function towerCentre(l: Landmark, fp: Vec2[]): Vec2 {
  const [ax, az] = l.anchor ? toLocal(l, l.anchor) : [0, 0];
  const h = TOWER_HALF + 0.05;
  for (let k = 0; k <= 20; k++) {
    const f = 1 - k / 20, x = ax * f, z = az * f;
    if ([[-h, -h], [h, -h], [h, h], [-h, h]].every(([dx, dz]) => pointInPolygon(x + dx, z + dz, fp))) return [x, z];
  }
  return [0, 0];
}

export function kurantyParts(l: Landmark): LandmarkParts {
  const fp = localFootprint(l);
  const [tx, tz] = towerCentre(l, fp);
  const parts = [
    box(TOWER_HALF * 2 + 0.6, 0.6, TOWER_HALF * 2 + 0.6, 0, BASE + 0.3, 0, WHITE),
    box(TOWER_HALF * 2, TOWER_TOP - BASE, TOWER_HALF * 2, 0, (BASE + TOWER_TOP) / 2, 0, WHITE),
    box(CLOCK_HALF * 2, CLOCK_Y1 - CLOCK_Y0, CLOCK_HALF * 2, 0, (CLOCK_Y0 + CLOCK_Y1) / 2, 0, WHITE),
    box(CLOCK_HALF * 2 + 0.3, 0.35, CLOCK_HALF * 2 + 0.3, 0, CLOCK_Y1 + 0.17, 0, CREAM),
    box(CLOCK_HALF * 2 + 0.3, 0.35, CLOCK_HALF * 2 + 0.3, 0, CLOCK_Y0 - 0.17, 0, CREAM),
    box(TOWER_HALF * 2 + 0.5, 0.5, TOWER_HALF * 2 + 0.5, 0, TOWER_TOP - 0.25, 0, CREAM),
    paint(new THREE.CylinderGeometry(0.9, 1.5, 1.6, 8).translate(0, TOWER_TOP + 0.8, 0), GREEN),
    paint(new THREE.ConeGeometry(0.9, 4.3, 8).translate(0, TOWER_TOP + 1.6 + 2.15, 0), GREEN),
    paint(new THREE.SphereGeometry(0.28, 8, 6).translate(0, SPIRE_TOP - 0.55, 0), GOLD),
    paint(new THREE.ConeGeometry(0.1, 0.5, 6).translate(0, SPIRE_TOP - 0.25, 0), GOLD),
  ];
  for (const a of sides) {
    parts.push(aroundY(archPanel(2.2, 4.4, SHADOW), a, TOWER_HALF + 0.02, BASE + 0.8));
    parts.push(aroundY(archPanel(1.2, 2.6, SHADOW), a, TOWER_HALF + 0.02, CLOCK_Y1 + 0.8));
    parts.push(aroundY(archPanel(0.8, 2.6, SHADOW), a, TOWER_HALF + 0.02, 12.5));
  }
  const faces = sides.map(a => aroundY(new THREE.PlaneGeometry(FACE, FACE), a, CLOCK_HALF + 0.03, (CLOCK_Y0 + CLOCK_Y1) / 2));
  return {
    solid: merge([
      paint(walls(fp, 0, BASE - 0.5), CREAM),
      paint(walls(fp, BASE - 0.5, BASE), WHITE),
      paint(cap(fp, BASE), ROOF),
      merge(parts).translate(tx, 0, tz),
    ]),
    textured: { geometry: merge(faces).translate(tx, 0, tz), texture: 'clock', fallback: 0xf6f2e8 },
  };
}

/** Cream dial, dark ring, twelve ticks, hands at ten past ten. */
export function drawClock(g: CanvasRenderingContext2D, size: number): void {
  const c = size / 2;
  g.fillStyle = '#f0ece2';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#c9a23f';
  g.beginPath();
  g.arc(c, c, c * 0.96, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f8f5ec';
  g.beginPath();
  g.arc(c, c, c * 0.84, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#2a2622';
  g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.lineWidth = size * (i % 3 ? 0.02 : 0.035);
    g.beginPath();
    g.moveTo(c + Math.sin(a) * c * 0.66, c - Math.cos(a) * c * 0.66);
    g.lineTo(c + Math.sin(a) * c * 0.78, c - Math.cos(a) * c * 0.78);
    g.stroke();
  }
  const hand = (turn: number, len: number, w: number) => {
    const a = turn * Math.PI * 2;
    g.lineWidth = size * w;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.sin(a) * c * len, c - Math.cos(a) * c * len);
    g.stroke();
  };
  hand(10 / 12 + 10 / 720, 0.45, 0.045);
  hand(10 / 60, 0.66, 0.03);
}

export function createClockTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  drawClock(canvas.getContext('2d')!, 128);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
