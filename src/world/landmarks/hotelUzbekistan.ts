import * as THREE from 'three';
import type { Landmark } from '../../shared/district';
import { type LandmarkParts, cap, localFootprint, merge, paint, walls } from './common';

export const HOTEL_HEIGHT = 71.5;
/** One tile is two floors high and two lattice diamonds wide. */
export const LATTICE_TILE = { u: 7.2, v: 8.4 };
const GROUND = 5.2;
const BAND = 4.2;
const WHITE = 0xeeebe4, PODIUM = 0x34414c, ROOF = 0x9a978f, SCREEN = 0xd4d8d8;

export function hotelUzbekistanParts(l: Landmark): LandmarkParts {
  const fp = localFootprint(l);
  const latticeTop = HOTEL_HEIGHT - BAND;
  const solid = merge([
    paint(walls(fp, 0, GROUND - 0.6), PODIUM),
    paint(walls(fp, GROUND - 0.6, GROUND), WHITE),
    paint(walls(fp, latticeTop, HOTEL_HEIGHT), WHITE),
    paint(cap(fp, HOTEL_HEIGHT), ROOF),
  ]);
  const lattice = walls(fp, GROUND, latticeTop, LATTICE_TILE);
  return { solid, textured: { geometry: lattice, texture: 'lattice', fallback: SCREEN } };
}

/** White rhombus screen over grey-blue glass with a floor slab line; the edges match so it tiles both ways. */
export function drawLattice(g: CanvasRenderingContext2D, size: number): void {
  const s = size;
  g.fillStyle = '#6d8290';
  g.fillRect(0, 0, s, s);
  g.fillStyle = 'rgba(200,220,232,0.3)';
  g.fillRect(0, s * 0.1, s, s * 0.35);
  g.strokeStyle = '#f1eee7';
  g.lineCap = 'square';
  g.lineWidth = s * 0.15;
  g.beginPath();
  for (const x0 of [-s, -s / 2, 0, s / 2, s]) {
    g.moveTo(x0, s);
    g.lineTo(x0 + s, 0);
    g.moveTo(x0, 0);
    g.lineTo(x0 + s, s);
  }
  g.stroke();
  g.fillStyle = '#f1eee7';
  g.fillRect(0, s - s * 0.06, s, s * 0.06);
  g.fillRect(0, 0, s, s * 0.02);
  g.fillRect(0, 0, s * 0.03, s);
  g.fillRect(s * 0.485, 0, s * 0.03, s);
  g.fillRect(s - s * 0.015, 0, s * 0.015, s);
}

export function createLatticeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  drawLattice(canvas.getContext('2d')!, 256);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
