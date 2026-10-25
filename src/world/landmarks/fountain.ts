import * as THREE from 'three';
import type { Landmark } from '../../shared/district';
import { type LandmarkParts, merge, paint } from './common';

const HEIGHT = 0.6;
const RIM = 0.35;
const STONE = 0xc9c1b2, STONE_DARK = 0x9d968a, WATER = 0x3f7f9a, JET = 0xd8eef5;
const RING_JETS = 6;

export function fountainParts(l: Landmark): LandmarkParts {
  const r = l.radius ?? 3;
  const inner = r - RIM;
  const basin = paint(new THREE.LatheGeometry([
    new THREE.Vector2(r, 0),
    new THREE.Vector2(r, HEIGHT),
    new THREE.Vector2(inner, HEIGHT),
    new THREE.Vector2(inner, 0.15),
  ], 32), STONE);
  const floor = paint(new THREE.CircleGeometry(inner, 32).rotateX(-Math.PI / 2).translate(0, 0.15, 0), STONE_DARK);
  const water = paint(new THREE.CircleGeometry(inner, 32).rotateX(-Math.PI / 2).translate(0, HEIGHT - 0.12, 0), WATER);
  const plinth = paint(new THREE.CylinderGeometry(0.35, 0.45, 0.9, 10).translate(0, 0.45, 0), STONE);

  const jets = [paint(new THREE.ConeGeometry(0.18, Math.min(3.2, r), 6, 1, true).translate(0, 0.9 + Math.min(3.2, r) / 2, 0), JET)];
  for (let i = 0; i < RING_JETS; i++) {
    const a = (i / RING_JETS) * Math.PI * 2, h = 1.6;
    jets.push(paint(new THREE.ConeGeometry(0.1, h, 6, 1, true).translate(Math.sin(a) * inner * 0.55, HEIGHT + h / 2 - 0.1, Math.cos(a) * inner * 0.55), JET));
  }
  return { solid: merge([basin, floor, water, plinth]), transparent: merge(jets) };
}
