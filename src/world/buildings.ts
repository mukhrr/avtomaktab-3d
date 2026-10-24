import * as THREE from 'three';
import type { Building } from '../shared/district';
import { addMerged } from './meshes';

// Warm stucco and beige tones typical of central Tashkent facades.
const PALETTE = [0xe8dcc4, 0xf2ece0, 0xd9c7a7, 0xcfd6d8, 0xe6d2b5, 0xbfc7c9];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function addBuildings(scene: THREE.Scene, buildings: Building[]): void {
  const byColour = PALETTE.map(() => [] as THREE.BufferGeometry[]);
  for (const b of buildings) {
    const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.deleteAttribute('uv');
    byColour[hash(b.id) % PALETTE.length].push(g);
  }
  byColour.forEach((geoms, i) => {
    const mesh = addMerged(scene, geoms, new THREE.MeshLambertMaterial({ color: PALETTE[i] }));
    if (mesh) mesh.castShadow = true;
  });
}
