import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pedView } from '../peds/pedView';
import { trafficView } from '../traffic/trafficView';
import { createCarModel } from '../vehicle/carModel';
import { buildWorld } from '../world/buildWorld';
import { createEnvironment } from '../world/environment';
import { createGroundMaterials } from '../world/groundMaterials';
import { testDistrict } from '../world/testDistrict';
import { useSkyAmbient } from './litMaterials';
import { QUALITY, type Quality } from './quality';

const stubLoader = { load: () => new THREE.Texture() } as unknown as THREE.TextureLoader;
const fakeEnvMaps = { fromScene: () => new THREE.WebGLRenderTarget(1, 1), dispose: () => {} };

/** Assembles the scene the way main.ts does. */
function gameScene(q: Quality) {
  const s = QUALITY[q];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const renderer = { toneMappingExposure: 1 } as unknown as THREE.WebGLRenderer;
  const mats = createGroundMaterials(s, stubLoader);
  const env = createEnvironment(scene, camera, renderer, s, 'noon', mats.ground, s.skyAmbient ? fakeEnvMaps : null);
  buildWorld(scene, testDistrict(), mats);
  trafficView(scene, 2);
  pedView(scene, 2);
  const car = createCarModel().root;
  scene.add(car);
  if (s.skyAmbient) useSkyAmbient(scene);
  env.setupScene(scene);
  const materials = new Set<THREE.Material>();
  scene.traverse(o => {
    const m = (o as THREE.Mesh).material;
    if (m) for (const x of Array.isArray(m) ? m : [m]) materials.add(x);
  });
  return { scene, car, materials };
}

const owned = (car: THREE.Object3D) => {
  const out = new Set<THREE.Material>();
  car.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m) out.add(m);
  });
  return out;
};

describe('lit materials per preset', () => {
  it('low keeps the world on Lambert with no sky ambient, as M3 did', () => {
    const { scene, car, materials } = gameScene('low');
    const carMats = owned(car);
    expect(scene.environment).toBeNull();
    for (const m of materials) {
      if (carMats.has(m)) continue;
      expect((m as THREE.MeshStandardMaterial).isMeshStandardMaterial ?? false).toBe(false);
    }
  });

  it.each(['medium', 'high'] as Quality[])('%s lights every lit material from the sky', q => {
    const { scene, materials } = gameScene(q);
    expect(scene.environment).not.toBeNull();
    for (const m of materials) expect((m as THREE.MeshLambertMaterial).isMeshLambertMaterial ?? false).toBe(false);
  });

  it('keeps colour, flat shading and sharing when converting', () => {
    const shared = new THREE.MeshLambertMaterial({ color: 0x4f7d34, flatShading: true });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.Mesh(new THREE.BoxGeometry(), shared));
    useSkyAmbient(root);
    const [a, b] = root.children.map(c => (c as THREE.Mesh).material as THREE.MeshStandardMaterial);
    expect(a).toBe(b);
    expect(a.isMeshStandardMaterial).toBe(true);
    expect(a.color.getHex()).toBe(0x4f7d34);
    expect(a.flatShading).toBe(true);
    expect(a.roughness).toBe(1);
    expect(a.metalness).toBe(0);
  });
});
