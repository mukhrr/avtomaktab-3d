import * as THREE from 'three';
import { expect, it } from 'vitest';
import { addBuildings } from './buildings';

it('building materials take ambient light from scene.environment', () => {
  const scene = new THREE.Scene();
  addBuildings(scene, [{ id: 'b1', footprint: [[0, 0], [10, 0], [10, 10], [0, 10]], height: 12 } as never]);
  const meshes = scene.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);
  expect(meshes.length).toBeGreaterThan(0);
  for (const m of meshes) expect((m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
});
