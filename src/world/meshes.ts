import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../shared/district';
import { ribbon } from './roadGeometry';

export function ribbonGeometry(points: Vec2[], width: number, y: number): THREE.BufferGeometry {
  const { positions, indices } = ribbon(points, width);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(indices);
  g.translate(0, y, 0);
  return g;
}

export function polygonGeometry(outline: Vec2[], y: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z))));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  g.deleteAttribute('uv');
  return g;
}

export function worldUVs(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / tile;
    uv[i * 2 + 1] = pos.getZ(i) / tile;
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export function addMerged(scene: THREE.Scene, geoms: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh | null {
  if (!geoms.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(geoms, false), material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  geoms.forEach(g => g.dispose());
  return mesh;
}
