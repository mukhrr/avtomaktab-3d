import * as THREE from 'three';
import type { QualitySettings } from '../render/quality';
import { createGroundMaterial, GROUND_TILE } from './groundMaterials';
import { worldUVs } from './meshes';

const SHADOW_HALF_SIZE = 120;

export function createEnvironment(scene: THREE.Scene, q: QualitySettings) {
  scene.background = new THREE.Color(0xa9cbe6);
  scene.fog = new THREE.Fog(0xc9d9e3, 250, 900);
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x8a7a5a, 1.1));

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_HALF_SIZE, right: SHADOW_HALF_SIZE, top: SHADOW_HALF_SIZE, bottom: -SHADOW_HALF_SIZE, near: 1, far: 600,
  });
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(worldUVs(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), GROUND_TILE.ground), createGroundMaterial(q, 'ground'));
  ground.receiveShadow = true;
  scene.add(ground);

  return {
    /** Keeps the shadow frustum centred on the area being looked at. */
    follow(x: number, z: number) {
      sun.position.set(x + 120, 200, z + 80);
      sun.target.position.set(x, 0, z);
    },
  };
}
